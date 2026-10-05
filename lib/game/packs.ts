import type { Prisma } from "@prisma/client";
import { CATEGORY_KEYS, type Category } from "../categories";
import { db } from "../db";
import { getSettings } from "../settings";
import { BIN, CHASE_RESERVE_CAP, cryptoRng, drawPacks, rollChase, round2, showable, shortages, slotOf, type Rng } from "./rules";

/**
 * Built packs for the reveal game, per category. Packs are drawn ahead of time from stock, so a purchase only
 * ever reserves a pack that already exists; it never assembles one on the spot.
 */

/** Cards that may be drawn: identified, priced stock with a photo, not in any pack. */
export const STOCK = ["Priced", "BulkHold"];
/** Keep up to this many available packs per category (more stock stays loose for later draws). */
export const AVAILABLE_TARGET = 50;

const poolWhere = (category: string): Prisma.CardWhereInput => ({
  category,
  status: { in: STOCK },
  readable: true,
  frontImage: { not: null },
  listPrice: { not: null },
  gamePackId: null,
  lilStackId: null,
});

/** Stock, by bin, for one category. Chase-priced cards are counted on their own and never drawn into normal packs. */
export async function bins(category: Category) {
  const cards = await db.card.findMany({ where: poolWhere(category), select: { id: true, listPrice: true } });
  const out = { bulk: 0, mid: 0, top: 0, between: 0, chase: 0 };
  for (const c of cards) {
    const s = slotOf(c.listPrice);
    if (s === "bulk" || s === "mid" || s === "top" || s === "chase") out[s]++;
    else out.between++;
  }
  return { ...out, short: shortages(cards.map((c) => ({ id: c.id, price: c.listPrice! }))) };
}

/** Draw new packs for one category until it has AVAILABLE_TARGET available, or the bins run out. */
export async function buildGamePacks(category: Category, rng: Rng = cryptoRng) {
  const available = await db.gamePack.count({ where: { category, status: "available" } });
  const want = Math.max(0, AVAILABLE_TARGET - available);
  if (!want) return { category, built: 0, available };
  const pool = await db.card.findMany({ where: poolWhere(category), select: { id: true, listPrice: true }, orderBy: { createdAt: "asc" } });
  const drawn = drawPacks(pool.map((c) => ({ id: c.id, price: c.listPrice! })), want, rng);
  let built = 0;
  for (const p of drawn) {
    // Claim the cards only if they're still free (a save or another build may have taken one).
    const ok = await db.$transaction(async (tx) => {
      const pack = await tx.gamePack.create({ data: { category, cardIds: p.ids, value: p.value } });
      const n = await tx.card.updateMany({ where: { id: { in: p.ids }, gamePackId: null, status: { in: STOCK } }, data: { gamePackId: pack.id, status: "LilStack" } });
      if (n.count !== p.ids.length) throw new Error("card taken");
      return true;
    }).catch(() => false);
    if (ok) built++;
  }
  return { category, built, available: available + built };
}

export async function buildAllGamePacks() {
  const out = [];
  for (const c of CATEGORY_KEYS) out.push(await buildGamePacks(c));
  return out;
}

/** Put a pack's cards back in stock. `status` says why: expired (passed / timer), dissolved (I changed a card). */
export async function releasePack(packId: string, status: "expired" | "dissolved", from: string[] = ["available", "reserved"]) {
  return db.$transaction(async (tx) => {
    const n = await tx.gamePack.updateMany({ where: { id: packId, status: { in: from } }, data: { status, closedAt: new Date() } });
    if (!n.count) return false;
    await tx.card.updateMany({ where: { gamePackId: packId, status: "LilStack" }, data: { gamePackId: null, status: "Priced" } });
    return true;
  });
}

/** A card I edited (price, category, pulled…) leaves its pack: an available pack dissolves; reserved/sold ones are left alone. */
export async function releaseCardFromGame(card: { gamePackId: string | null }) {
  if (!card.gamePackId) return;
  await releasePack(card.gamePackId, "dissolved", ["available"]);
}

/** Every $10+ scanned card in a category (the chase list), and which ones are ready to drop into a pack. */
export async function chaseList(category: Category) {
  const cards = await db.card.findMany({
    where: { category, listPrice: { gte: BIN.chaseFrom }, status: { notIn: ["Sold", "Archived"] } },
    orderBy: { listPrice: "desc" },
  });
  return cards.map((c) => ({ ...c, eligible: STOCK.includes(c.status) && !c.gamePackId && !c.lilStackId && c.readable && !!c.frontImage }));
}

/**
 * Reserve one available pack for a player. Peek and blind use this same call, so they share packs and odds.
 * With the chase flag on, 1 in 25 reservations swaps the top slot for a chase card (capped while reserved).
 */
export async function reservePack(category: Category, buyerId: string, rng: Rng = cryptoRng) {
  const s = await getSettings();
  const chaseOn = !!s.chaseOn?.[category];
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidates = (await db.gamePack.findMany({ where: { category, status: "available" }, select: { id: true, value: true, chase: true } })).filter(showable);
    if (!candidates.length) return null;
    const pick = candidates[rng(candidates.length)];
    const n = await db.gamePack.updateMany({ where: { id: pick.id, status: "available" }, data: { status: "reserved", reservedBy: buyerId, reservedAt: new Date() } });
    if (!n.count) continue; // someone else got it first
    if (chaseOn && rollChase(rng)) await swapInChase(pick.id, category, rng);
    return db.gamePack.findUniqueOrThrow({ where: { id: pick.id } });
  }
  return null;
}

/** Swap the top-slot card of a just-reserved pack for a chase card, if the cap and the list allow. */
async function swapInChase(packId: string, category: Category, rng: Rng) {
  const live = await db.gamePack.count({ where: { category, status: "reserved", chase: true } });
  if (live >= CHASE_RESERVE_CAP) return false;
  const chase = (await chaseList(category)).filter((c) => c.eligible);
  if (!chase.length) return false;
  const card = chase[rng(chase.length)];
  return db
    .$transaction(async (tx) => {
      const pack = await tx.gamePack.findUniqueOrThrow({ where: { id: packId }, include: { cards: { select: { id: true, listPrice: true } } } });
      const top = pack.cards.find((c) => slotOf(c.listPrice) === "top");
      if (!top) throw new Error("no top slot");
      const took = await tx.card.updateMany({ where: { id: card.id, gamePackId: null, status: { in: STOCK } }, data: { gamePackId: packId, status: "LilStack" } });
      if (!took.count) throw new Error("chase card taken");
      await tx.card.update({ where: { id: top.id }, data: { gamePackId: null, status: "Priced" } });
      const cardIds = pack.cardIds.map((id) => (id === top.id ? card.id : id));
      const value = round2(pack.cards.reduce((n, c) => n + (c.id === top.id ? card.listPrice! : c.listPrice ?? 0), 0));
      await tx.gamePack.update({ where: { id: packId }, data: { cardIds, value, chase: true, chaseCardId: card.id } });
      return true;
    })
    .catch(() => false);
}

/** Turning a category's chase flag off: no chase pack may stay up. Only reserved ones can hold one; leave those to finish. */
export async function setChase(category: Category, on: boolean) {
  const { saveSettings } = await import("../settings");
  const s = await getSettings();
  if (on && !(await chaseList(category)).length) throw new Error("Scan at least one card priced $10 or more in this category first.");
  await saveSettings({ chaseOn: { ...s.chaseOn, [category]: on } });
}

/** Whether a new game can start in a category, and why not. */
export async function categoryStatus(category: Category) {
  const s = await getSettings();
  const available = (await db.gamePack.findMany({ where: { category, status: "available" }, select: { value: true, chase: true } })).filter(showable).length;
  return { category, available, open: available > 0, chaseOn: !!s.chaseOn?.[category] };
}

/** The 12 cards a player may see for a pack: name, set, engine price, in pack order. */
export async function packView(packId: string) {
  const pack = await db.gamePack.findUniqueOrThrow({
    where: { id: packId },
    include: { cards: { select: { id: true, game: true, name: true, player: true, setName: true, year: true, listPrice: true } } },
  });
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const cards = pack.cardIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      id: c.id,
      name: (c.game === "Sports" ? c.player || c.name : c.name) || "Mystery card",
      setName: [c.year, c.setName].filter(Boolean).join(" ") || null,
      price: c.listPrice ?? 0,
      chase: c.id === pack.chaseCardId,
    }))
    .sort((a, b) => a.price - b.price); // best card last: the reveal builds to it
  return { id: pack.id, category: pack.category, value: pack.value, chase: pack.chase, cards };
}
export type PackView = Awaited<ReturnType<typeof packView>>;
