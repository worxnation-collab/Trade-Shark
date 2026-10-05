import type { Buyer } from "@prisma/client";
import { isCategory, productName, type Category } from "../categories";
import { db } from "../db";
import { splitSale } from "../lilStack";
import { chargeApi, chargeSaved, refund, type ChargeApi } from "./charge";
import { buildGamePacks, categoryStatus, packView, releasePack, reservePack } from "./packs";
import { KEEP_GRACE_MS, PRICES, TIMER_SECONDS, cryptoRng, nextLocalMidnight, type Rng } from "./rules";

/**
 * One play per account at a time:
 *   $1 reveal (charged first) → a reserved pack, 30 s → Keep ($2.99 more) | Pass / timer / leave.
 *   After a pass the category is locked until local midnight, and the only action left is a $4.99 blind pack
 *   (charged first, then reserved and revealed; no reject). A keep or a blind buy unlocks a new cycle at once.
 * Nothing is ever charged by the timer.
 */

export type PlayError = { ok: false; error: string; code?: string };
const err = (error: string, code?: string): PlayError => ({ ok: false, error, code });

/** Close any reveal whose 30 s (+ grace) ran out. Lazy: runs at the top of every play request. */
export async function sweepExpired(now = new Date()) {
  const stale = await db.gameCycle.findMany({ where: { status: "revealing", deadline: { lt: new Date(now.getTime() - KEEP_GRACE_MS) } }, include: { buyer: true } });
  for (const c of stale) await endWithoutPurchase(c.id, c.buyer, "expired", now);
  // A request that died between "charging" and the reveal shouldn't block the account forever.
  await db.gameCycle.updateMany({ where: { status: "charging", createdAt: { lt: new Date(now.getTime() - 120_000) } }, data: { status: "failed", endedAt: now } });
  return stale.length;
}

async function activeLock(buyer: Pick<Buyer, "id" | "cardFingerprint">, category: string, now = new Date()) {
  return db.gameLock.findFirst({
    where: {
      category,
      until: { gt: now },
      OR: [{ buyerId: buyer.id }, ...(buyer.cardFingerprint ? [{ fingerprint: buyer.cardFingerprint }] : [])],
    },
    orderBy: { until: "desc" },
  });
}

/** What the play screen needs for one category. */
export async function playState(buyer: Buyer | null, category: Category) {
  await sweepExpired();
  const status = await categoryStatus(category);
  if (!buyer) return { ...status, signedIn: false as const, hasCard: false, lockedUntil: null, revealing: null };
  const [lock, revealing] = await Promise.all([
    activeLock(buyer, category),
    db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: "revealing" } }),
  ]);
  return {
    ...status,
    signedIn: true as const,
    hasCard: !!buyer.paymentMethodId,
    cardLabel: buyer.cardLabel,
    lockedUntil: lock?.until ?? null,
    serverNow: new Date(),
    revealing: revealing
      ? { cycleId: revealing.id, category: revealing.category, deadline: revealing.deadline!, pack: revealing.category === category && revealing.packId ? await packView(revealing.packId) : null }
      : null,
  };
}

/** Step 2–4: charge $1, reserve a pack, start the 30 s clock. */
export async function reveal(buyer: Buyer, category: string, opts: { api?: ChargeApi | null; rng?: Rng; now?: Date } = {}) {
  if (!isCategory(category)) return err("Pick baseball, football or Pokemon.");
  if (!buyer.paymentMethodId) return err("Save a card before your first reveal.", "no-card");
  const now = opts.now ?? new Date();
  await sweepExpired(now);
  if (await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: { in: ["revealing", "charging", "keeping"] } } })) return err("Finish the pack you have open first.", "busy");
  const lock = await activeLock(buyer, category, now);
  if (lock) return err(`${productName(category)}s are closed for you until midnight. The $4.99 pack is still open.`, "locked");
  if (!(await categoryStatus(category)).open) return err(`No ${productName(category)}s are ready right now.`, "closed");

  const cycle = await db.gameCycle.create({ data: { buyerId: buyer.id, category, kind: "peek", status: "charging" } });
  const api = opts.api !== undefined ? opts.api : chargeApi();
  const paid = await chargeSaved(buyer, PRICES.reveal, "reveal", cycle.id, `Trade Shark · ${productName(category)} reveal`, api);
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(paid.error, "declined");
  }
  const pack = await reservePack(category, buyer.id, opts.rng ?? cryptoRng);
  if (!pack) {
    // Took the $1 but the last pack went to someone else a moment ago: give it back.
    await refund(buyer.id, cycle.id, paid.paymentIntentId, PRICES.reveal, api);
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(`The last ${productName(category)} just went. Your $1 was refunded.`, "closed");
  }
  const deadline = new Date(now.getTime() + TIMER_SECONDS * 1000);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "revealing", packId: pack.id, revealedAt: now, deadline } });
  return { ok: true as const, cycleId: cycle.id, deadline, serverNow: new Date(), pack: await packView(pack.id) };
}

/** Step 5: Keep. Charge $2.99 more ($3.99 in all), the cards are theirs, the cycle closes. */
export async function keep(buyer: Buyer, cycleId: string, opts: { api?: ChargeApi | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const cycle = await db.gameCycle.findFirst({ where: { id: cycleId, buyerId: buyer.id } });
  if (!cycle || !cycle.packId) return err("That pack isn't yours.");
  if (cycle.status !== "revealing") return err("This pack is closed.", "closed");
  if (now.getTime() > cycle.deadline!.getTime() + KEEP_GRACE_MS) {
    await endWithoutPurchase(cycle.id, buyer, "expired", now);
    return err("Time ran out on that pack.", "expired");
  }
  // One Keep at a time (double taps).
  const claimed = await db.gameCycle.updateMany({ where: { id: cycle.id, status: "revealing" }, data: { status: "keeping" } });
  if (!claimed.count) return err("This pack is closed.", "closed");
  const paid = await chargeSaved(buyer, PRICES.keepMore, "keep", cycle.id, `Trade Shark · ${productName(cycle.category)} kept`, opts.api !== undefined ? opts.api : chargeApi());
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "revealing" } }); // the clock keeps running
    return err(paid.error, "declined");
  }
  await sellPack(cycle.packId, buyer, PRICES.keepTotal, "kept", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "kept", endedAt: now } });
  return { ok: true as const, pack: await packView(cycle.packId) };
}

/** Step 6: Pass, the timer, or leaving the screen. Never charges. */
export async function pass(buyer: Buyer, cycleId: string, now = new Date()) {
  const cycle = await db.gameCycle.findFirst({ where: { id: cycleId, buyerId: buyer.id } });
  if (!cycle) return err("That pack isn't yours.");
  if (cycle.status !== "revealing") return { ok: true as const, already: true };
  await endWithoutPurchase(cycle.id, buyer, "passed", now);
  return { ok: true as const, already: false };
}

async function endWithoutPurchase(cycleId: string, buyer: Pick<Buyer, "id" | "tz" | "cardFingerprint">, status: "passed" | "expired", now: Date) {
  const done = await db.gameCycle.updateMany({ where: { id: cycleId, status: "revealing" }, data: { status, endedAt: now } });
  if (!done.count) return;
  const cycle = await db.gameCycle.findUniqueOrThrow({ where: { id: cycleId } });
  // The pack is gone for this player; its cards go back to stock (it can't be reopened).
  if (cycle.packId) await releasePack(cycle.packId, "expired", ["reserved"]);
  await db.gameLock.create({ data: { buyerId: buyer.id, fingerprint: buyer.cardFingerprint, category: cycle.category, until: nextLocalMidnight(now, buyer.tz) } });
  // Its cards are back in the bins: draw them into fresh packs (a new random mix, never the same pack reopened).
  if (isCategory(cycle.category)) await buildGamePacks(cycle.category).catch((e) => console.error("redraw failed", e));
}

/** Step 7: the blind pack. Charge $4.99 first, then reserve from the same builder, then reveal. No reject. */
export async function blind(buyer: Buyer, category: string, opts: { api?: ChargeApi | null; rng?: Rng; now?: Date } = {}) {
  if (!isCategory(category)) return err("Pick baseball, football or Pokemon.");
  if (!buyer.paymentMethodId) return err("Save a card first.", "no-card");
  const now = opts.now ?? new Date();
  await sweepExpired(now);
  if (await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: { in: ["revealing", "charging", "keeping"] } } })) return err("Finish the pack you have open first.", "busy");
  // The blind pack is what's left after a pass: it's only offered while that category is locked for them.
  const lock = await activeLock(buyer, category, now);
  if (!lock) return err("The $4.99 pack opens after you pass on a reveal.", "not-offered");
  if (!(await categoryStatus(category)).open) return err(`No ${productName(category)}s are ready right now.`, "closed");

  const cycle = await db.gameCycle.create({ data: { buyerId: buyer.id, category, kind: "blind", status: "charging" } });
  const api = opts.api !== undefined ? opts.api : chargeApi();
  const paid = await chargeSaved(buyer, PRICES.blind, "blind", cycle.id, `Trade Shark · ${productName(category)} blind pack`, api);
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(paid.error, "declined");
  }
  const pack = await reservePack(category, buyer.id, opts.rng ?? cryptoRng);
  if (!pack) {
    await refund(buyer.id, cycle.id, paid.paymentIntentId, PRICES.blind, api);
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(`The last ${productName(category)} just went. Your $4.99 was refunded.`, "closed");
  }
  await sellPack(pack.id, buyer, PRICES.blind, "sold-blind", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "blind-bought", packId: pack.id, revealedAt: now, endedAt: now } });
  // A completed purchase unlocks a new cycle right away.
  await db.gameLock.deleteMany({ where: { category, OR: [{ buyerId: buyer.id }, ...(buyer.cardFingerprint ? [{ fingerprint: buyer.cardFingerprint }] : [])] } });
  return { ok: true as const, pack: await packView(pack.id) };
}

/** The pack and its cards are sold: assign them, split the money across the cards by engine price. */
async function sellPack(packId: string, buyer: Pick<Buyer, "id" | "shipTo">, total: number, status: "kept" | "sold-blind", now: Date) {
  const pack = await db.gamePack.findUniqueOrThrow({ where: { id: packId }, include: { cards: { select: { id: true, listPrice: true } } } });
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const cards = pack.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const shares = splitSale(total, cards.map((c) => c.listPrice ?? 0));
  await db.$transaction([
    db.gamePack.update({ where: { id: packId }, data: { status, closedAt: now, charged: total, shipTo: buyer.shipTo, reservedBy: buyer.id } }),
    ...cards.map((c, i) => db.card.update({ where: { id: c.id }, data: { status: "Sold", soldPrice: shares[i], soldChannel: "game", soldAt: now } })),
  ]);
}
