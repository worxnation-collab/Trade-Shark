import type { Card } from "@prisma/client";
import { db } from "./db";
import { LIL_STACK_UNDER, statusAfterPricing } from "./pricing/engine";
import { getSettings } from "./settings";

/**
 * Lil' Stack: every identified + priced card under $1 goes into a free pack instead of selling as a single.
 * - Packs are per batch, up to 12 cards; more qualifying cards make Lil' Stack 2, 3, …
 * - A card sits in at most one pack (Card.lilStackId); the pack keeps its order in cardIds.
 * - Packs are never sold: no price, no pay link, no checkout. Opening one only shows what's inside.
 */
export const LIL_STACK_SIZE = 12;
export { LIL_STACK_UNDER };

/** Statuses a card can be packed from. Ready/Listed/Sold are owner decisions and never get pulled in. */
const PACKABLE = ["Priced", "BulkHold", "LilStack"];

type PackCandidate = Pick<Card, "id" | "status" | "listPrice" | "readable" | "frontImage" | "pile">;

export function qualifies(c: PackCandidate) {
  return (
    PACKABLE.includes(c.status) &&
    c.readable &&
    !!c.frontImage &&
    c.pile !== "duplicate" &&
    c.listPrice != null &&
    c.listPrice < LIL_STACK_UNDER
  );
}

/** Split ids into packs of up to `size`, in order. */
export function planPacks(ids: string[], size = LIL_STACK_SIZE): string[][] {
  const packs: string[][] = [];
  for (let i = 0; i < ids.length; i += size) packs.push(ids.slice(i, i + size));
  return packs;
}

/** Public name: the first pack is "Lil' Stack", then "Lil' Stack 2", "Lil' Stack 3", … */
export const packLabel = (n: number) => (n <= 1 ? "Lil' Stack" : `Lil' Stack ${n}`);

/**
 * Rebuild one batch's packs from scratch: qualifying cards are packed in scan order,
 * cards that no longer qualify go back to the normal pricing path.
 */
export async function buildLilStacks(batchId: string) {
  const s = await getSettings();
  const cards = await db.card.findMany({
    where: { batchId },
    select: { id: true, status: true, listPrice: true, readable: true, frontImage: true, pile: true },
    orderBy: { pairId: "asc" },
  });
  const packIds = cards.filter(qualifies).map((c) => c.id);
  const released = cards.filter((c) => c.status === "LilStack" && !qualifies(c));
  const packs = planPacks(packIds);

  await db.$transaction([
    // Deleting the packs clears every card's lilStackId (ON DELETE SET NULL).
    db.lilStack.deleteMany({ where: { batchId } }),
    ...released.map((c) =>
      db.card.update({ where: { id: c.id }, data: { status: statusAfterPricing("Priced", c.listPrice, true, s) } }),
    ),
    ...packs.map((ids, i) =>
      db.lilStack.create({ data: { batchId, seq: i + 1, cardIds: ids, cards: { connect: ids.map((id) => ({ id })) } } }),
    ),
    db.card.updateMany({ where: { id: { in: packIds } }, data: { status: "LilStack" } }),
  ]);
  return { batchId, packs: packs.length, cards: packIds.length, released: released.length };
}

/** Rebuild every batch that has packs or cards that could be packed. */
export async function rebuildAllLilStacks() {
  const batches = await db.batch.findMany({
    where: {
      OR: [
        { lilStacks: { some: {} } },
        { cards: { some: { status: { in: PACKABLE }, listPrice: { lt: LIL_STACK_UNDER } } } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const results = [];
  for (const b of batches) results.push(await buildLilStacks(b.id));
  return {
    batches: results.length,
    packs: results.reduce((n, r) => n + r.packs, 0),
    cards: results.reduce((n, r) => n + r.cards, 0),
    released: results.reduce((n, r) => n + r.released, 0),
  };
}

/** Take one card out of its pack (it was repriced to $1+, sold by hand, archived…). Empty packs are removed. */
export async function releaseFromPack(card: Pick<Card, "id" | "lilStackId">) {
  if (!card.lilStackId) return;
  const pack = await db.lilStack.findUnique({ where: { id: card.lilStackId } });
  await db.card.update({ where: { id: card.id }, data: { lilStackId: null } });
  if (!pack) return;
  const left = pack.cardIds.filter((id) => id !== card.id);
  if (left.length) await db.lilStack.update({ where: { id: pack.id }, data: { cardIds: left } });
  else await db.lilStack.delete({ where: { id: pack.id } });
}

/** Only what the public pack page may show: the front, name and set. No price, ever. */
export const LIL_STACK_CARD_SELECT = {
  id: true,
  game: true,
  name: true,
  player: true,
  setName: true,
  number: true,
  year: true,
} as const;

export interface PublicPack {
  id: string;
  label: string;
  cards: { id: string; name: string; setName: string | null }[];
}

/** Packs for the shop, oldest batch first, each card in its pack order. */
export async function publicPacks(): Promise<PublicPack[]> {
  const packs = await db.lilStack.findMany({
    orderBy: [{ batch: { createdAt: "asc" } }, { seq: "asc" }],
    select: {
      id: true,
      cardIds: true,
      cards: { where: { status: "LilStack", readable: true }, select: LIL_STACK_CARD_SELECT },
    },
  });
  return packs
    .map((p) => {
      const byId = new Map(p.cards.map((c) => [c.id, c]));
      const cards = p.cardIds
        .map((id) => byId.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({
          id: c.id,
          name: (c.game === "Sports" ? c.player || c.name : c.name) || "Mystery card",
          setName: [c.year, c.setName].filter(Boolean).join(" ") || null,
        }));
      return { id: p.id, cards };
    })
    .filter((p) => p.cards.length)
    .map((p, i) => ({ ...p, label: packLabel(i + 1) }));
}
