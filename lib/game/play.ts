import type { Buyer } from "@prisma/client";
import { isCategory, productName, type Category } from "../categories";
import { db } from "../db";
import { splitSale } from "../lilStack";
import { chargeApi, chargeSaved, refund, type ChargeApi } from "./charge";
import { isMember, perkLeft, refreshMember, usePerk } from "./member";
import { buildGamePacks, categoryStatus, packView, releasePack, reservePack } from "./packs";
import { placeInParcel, quoteShipping, validQuote, lineFor, type ShipLine } from "./ship";
import { KEEP_GRACE_MS, PRICES, TIMER_SECONDS, cryptoRng, nextLocalMidnight, type Rng } from "./rules";

/**
 * One play per account at a time:
 *   $1 reveal (charged first) → a reserved pack and its one shipping line, 30 s → Keep ($2.99 + shipping) | Pass / timer / leave.
 *   After a pass the category is locked until local midnight, and the only action left is a $4.99 blind pack
 *   (+ shipping, charged first, then reserved and revealed; no reject). A keep or a blind buy unlocks a new cycle at once.
 *   Members skip the midnight lock, get one bumped member stack and one mailer credit a month, and see new drops first.
 * Nothing is ever charged by the timer.
 */

export type { ShipLine };
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
export async function playState(buyerIn: Buyer | null, category: Category) {
  await sweepExpired();
  const buyer = buyerIn ? await refreshMember(buyerIn) : null;
  const member = isMember(buyer);
  const status = await categoryStatus(category, member);
  if (!buyer) return { ...status, signedIn: false as const, hasCard: false, member: false, stackLeft: false, lockedUntil: null, revealing: null };
  const [lock, revealing, stackLeft] = await Promise.all([
    activeLock(buyer, category),
    db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: "revealing" } }),
    perkLeft(buyer, "stack"),
  ]);
  const quote = revealing?.shipQuoteId ? await db.shipQuote.findUnique({ where: { id: revealing.shipQuoteId } }) : null;
  return {
    ...status,
    signedIn: true as const,
    hasCard: !!buyer.paymentMethodId,
    cardLabel: buyer.cardLabel,
    member,
    stackLeft,
    lockedUntil: lock?.until ?? null,
    serverNow: new Date(),
    revealing: revealing
      ? {
          cycleId: revealing.id,
          category: revealing.category,
          deadline: revealing.deadline!,
          pack: revealing.category === category && revealing.packId ? await packView(revealing.packId) : null,
          ship: quote ? lineFor(quote) : null,
        }
      : null,
  };
}

/** The shipping line for the blind pack button (and a fresh one if a Keep finds its quote stale). */
export async function shipQuote(buyer: Buyer) {
  return { ok: true as const, ship: await quoteShipping(buyer) };
}

/** Step 2–4: charge $1, reserve a pack, quote its one shipping line, start the 30 s clock. */
export async function reveal(buyerIn: Buyer, category: string, opts: { api?: ChargeApi | null; rng?: Rng; now?: Date; memberStack?: boolean } = {}) {
  if (!isCategory(category)) return err("Pick baseball, football or Pokemon.");
  if (!buyerIn.paymentMethodId) return err("Save a card before your first reveal.", "no-card");
  const now = opts.now ?? new Date();
  await sweepExpired(now);
  const buyer = await refreshMember(buyerIn);
  const member = isMember(buyer, now);
  if (await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: { in: ["revealing", "charging", "keeping"] } } })) return err("Finish the pack you have open first.", "busy");
  // Members skip the midnight lockout; everyone else waits (or takes the blind pack).
  if (!member && (await activeLock(buyer, category, now))) return err(`${productName(category)}s are closed for you until midnight. The $4.99 pack is still open.`, "locked");
  if (!(await categoryStatus(category, member, now)).open) return err(`No ${productName(category)}s are ready right now.`, "closed");
  const memberStack = !!opts.memberStack && member && (await perkLeft(buyer, "stack"));
  if (opts.memberStack && !memberStack) return err("Your member stack for this month is used (or your membership isn't active).", "no-stack");

  const cycle = await db.gameCycle.create({ data: { buyerId: buyer.id, category, kind: "peek", status: "charging" } });
  const api = opts.api !== undefined ? opts.api : chargeApi();
  const paid = await chargeSaved(buyer, PRICES.reveal, "reveal", cycle.id, `Trade Shark · ${productName(category)} reveal`, api);
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(paid.error, "declined");
  }
  const got = await reservePack(category, buyer.id, { rng: opts.rng ?? cryptoRng, member, memberStack, now });
  if (!got) {
    // Took the $1 but the last pack went to someone else a moment ago: give it back.
    await refund(buyer.id, cycle.id, paid.paymentIntentId, PRICES.reveal, api);
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(`The last ${productName(category)} just went. Your $1 was refunded.`, "closed");
  }
  // The member stack is used once it's shown with its bumped card (no $2–$4 card in stock = not used).
  if (memberStack && got.bumped) await usePerk(buyer, "stack");
  const [ship, pack] = await Promise.all([quoteShipping(buyer), packView(got.pack.id)]);
  const deadline = new Date(now.getTime() + TIMER_SECONDS * 1000);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "revealing", packId: got.pack.id, revealedAt: now, deadline, member: memberStack && got.bumped, shipQuoteId: ship.quoteId } });
  return { ok: true as const, cycleId: cycle.id, deadline, serverNow: new Date(), pack, ship };
}

/** Step 5: Keep. Charge $2.99 more ($3.99 in all) plus the shipping line shown, the cards are theirs, the cycle closes. */
export async function keep(buyer: Buyer, cycleId: string, opts: { api?: ChargeApi | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const cycle = await db.gameCycle.findFirst({ where: { id: cycleId, buyerId: buyer.id } });
  if (!cycle || !cycle.packId) return err("That pack isn't yours.");
  if (cycle.status !== "revealing") return err("This pack is closed.", "closed");
  if (now.getTime() > cycle.deadline!.getTime() + KEEP_GRACE_MS) {
    await endWithoutPurchase(cycle.id, buyer, "expired", now);
    return err("Time ran out on that pack.", "expired");
  }
  // The shipping they saw must still hold (a joined parcel can ship, a credit can get used elsewhere).
  const quote = await validQuote(buyer, cycle.shipQuoteId, now);
  if (!quote) {
    const ship = await quoteShipping(buyer);
    await db.gameCycle.update({ where: { id: cycle.id }, data: { shipQuoteId: ship.quoteId } });
    return { ...err(`Shipping changed: ${ship.label}. Tap Keep again to confirm.`, "ship-changed"), ship };
  }
  // One Keep at a time (double taps).
  const claimed = await db.gameCycle.updateMany({ where: { id: cycle.id, status: "revealing" }, data: { status: "keeping" } });
  if (!claimed.count) return err("This pack is closed.", "closed");
  const total = Math.round((PRICES.keepMore + quote.amount) * 100) / 100;
  const paid = await chargeSaved(buyer, total, "keep", cycle.id, `Trade Shark · ${productName(cycle.category)} kept${quote.amount ? " + shipping" : ""}`, opts.api !== undefined ? opts.api : chargeApi());
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "revealing" } }); // the clock keeps running
    return err(paid.error, "declined");
  }
  await sellPack(cycle.packId, buyer, PRICES.keepTotal, "kept", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "kept", endedAt: now } });
  const order = await placeInParcel(buyer, quote, cycle.packId);
  return { ok: true as const, pack: await packView(cycle.packId), shipping: quote.amount, tracking: order.trackingUrl };
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

/** Step 7: the blind pack. Charge $4.99 + the shipping line first, then reserve from the same queue, then reveal. No reject. */
export async function blind(buyerIn: Buyer, category: string, opts: { api?: ChargeApi | null; rng?: Rng; now?: Date; quoteId?: string } = {}) {
  if (!isCategory(category)) return err("Pick baseball, football or Pokemon.");
  if (!buyerIn.paymentMethodId) return err("Save a card first.", "no-card");
  const now = opts.now ?? new Date();
  await sweepExpired(now);
  const buyer = await refreshMember(buyerIn);
  const member = isMember(buyer, now);
  if (await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: { in: ["revealing", "charging", "keeping"] } } })) return err("Finish the pack you have open first.", "busy");
  // The blind pack is what's left after a pass: it's only offered while that category is locked for them.
  const lock = await activeLock(buyer, category, now);
  if (!lock) return err("The $4.99 pack opens after you pass on a reveal.", "not-offered");
  if (!(await categoryStatus(category, member, now)).open) return err(`No ${productName(category)}s are ready right now.`, "closed");
  const quote = await validQuote(buyer, opts.quoteId, now);
  if (!quote) {
    const ship = await quoteShipping(buyer);
    return { ...err(`Shipping: ${ship.label}. Tap again to buy.`, "ship-changed"), ship };
  }

  const cycle = await db.gameCycle.create({ data: { buyerId: buyer.id, category, kind: "blind", status: "charging", shipQuoteId: quote.id } });
  const api = opts.api !== undefined ? opts.api : chargeApi();
  const total = Math.round((PRICES.blind + quote.amount) * 100) / 100;
  const paid = await chargeSaved(buyer, total, "blind", cycle.id, `Trade Shark · ${productName(category)} blind pack${quote.amount ? " + shipping" : ""}`, api);
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(paid.error, "declined");
  }
  const got = await reservePack(category, buyer.id, { rng: opts.rng ?? cryptoRng, member, now });
  if (!got) {
    await refund(buyer.id, cycle.id, paid.paymentIntentId, total, api);
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "failed", endedAt: now } });
    return err(`The last ${productName(category)} just went. Your $${total.toFixed(2)} was refunded.`, "closed");
  }
  await sellPack(got.pack.id, buyer, PRICES.blind, "sold-blind", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "blind-bought", packId: got.pack.id, revealedAt: now, endedAt: now } });
  // A completed purchase unlocks a new cycle right away.
  await db.gameLock.deleteMany({ where: { category, OR: [{ buyerId: buyer.id }, ...(buyer.cardFingerprint ? [{ fingerprint: buyer.cardFingerprint }] : [])] } });
  const order = await placeInParcel(buyer, quote, got.pack.id);
  return { ok: true as const, pack: await packView(got.pack.id), shipping: quote.amount, tracking: order.trackingUrl };
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
