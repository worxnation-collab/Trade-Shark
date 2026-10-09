import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getSettings } from "../settings";

/**
 * The vault: singles won as prizes, held for the player. Winning never ships anything. The exact card is reserved
 * (Card.status Vaulted, so no pack, case or sale can take it) and a VaultItem row puts it in the player's Collection.
 * From there they ship it (Collection → Ship: quote → confirm → charge → label, in ./ship) or sell it back for store
 * credit, which returns the card to stock.
 */
export const VAULT_STATUSES = ["in_vault", "ship_requested", "shipped", "sold_back", "cancelled"] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];
export const VAULTED = "Vaulted";

type Tx = Prisma.TransactionClient;
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Reserve one card and put it in a player's vault, inside the caller's transaction. `where` is the stock rule the
 * card must still meet at the moment of the write (so a pack that took it a moment ago wins). Returns null if it lost.
 */
export async function vaultCard(
  tx: Tx,
  a: { buyerId: string; cardId: string; where: Prisma.CardWhereInput; source: string; sourceRef: string | null; now: Date },
) {
  const card = await tx.card.findFirst({
    where: { AND: [{ id: a.cardId }, a.where] },
    select: { id: true, status: true, game: true, name: true, player: true, condition: true, listPrice: true, suggestedPrice: true, frontImage: true, frontDisplay: true },
  });
  if (!card) return null;
  const took = await tx.card.updateMany({ where: { AND: [{ id: card.id }, a.where] }, data: { status: VAULTED } });
  if (!took.count) return null;
  return tx.vaultItem.create({
    data: {
      buyerId: a.buyerId,
      cardId: card.id,
      name: (card.game === "Sports" ? card.player || card.name : card.name) || "Card",
      image: card.frontDisplay ?? card.frontImage,
      condition: card.condition,
      value: cents(card.listPrice ?? card.suggestedPrice ?? 0),
      source: a.source,
      sourceRef: a.sourceRef,
      status: "in_vault",
      stockStatus: card.status,
      wonAt: a.now,
    },
  });
}

/** The player's vault, newest first (every status, so shipped and sold-back singles stay visible). */
export async function vaultItems(buyerId: string) {
  return db.vaultItem.findMany({
    where: { buyerId },
    orderBy: { wonAt: "desc" },
    select: { id: true, cardId: true, name: true, condition: true, value: true, source: true, sourceRef: true, status: true, wonAt: true, orderId: true, order: { select: { trackingUrl: true } } },
  });
}

export async function creditBalance(buyerId: string) {
  const r = await db.creditEntry.aggregate({ where: { buyerId }, _sum: { amount: true } });
  return cents(r._sum.amount ?? 0);
}

export const sellBackAmount = (value: number, pct: number) => cents((value * Math.min(100, Math.max(0, pct))) / 100);

/** What selling one vault single back would pay, for the confirm step. Only the owner's in-vault rows. */
export async function sellBackQuote(buyerId: string, itemId: string) {
  const item = await db.vaultItem.findFirst({ where: { id: itemId, buyerId, status: "in_vault", orderId: null }, select: { id: true, value: true } });
  if (!item) return null;
  const { sellBackPct } = await getSettings();
  return { id: item.id, pct: sellBackPct, credit: sellBackAmount(item.value, sellBackPct) };
}

/**
 * Sell a vault single back: the row flips to sold_back, the card goes back to the stock status it had before it was
 * won, and the credit is written to the ledger, all at once. Someone else's row, a second tap, or a single already
 * asked to ship changes nothing.
 */
export async function sellBack(buyerId: string, itemId: string, now = new Date()) {
  const { sellBackPct } = await getSettings();
  const r = await db
    .$transaction(async (tx) => {
      const item = await tx.vaultItem.findFirst({ where: { id: itemId, buyerId, status: "in_vault", orderId: null } });
      if (!item) return null;
      const flip = await tx.vaultItem.updateMany({ where: { id: item.id, buyerId, status: "in_vault", orderId: null }, data: { status: "sold_back", updatedAt: now } });
      if (!flip.count) return null;
      await tx.card.updateMany({ where: { id: item.cardId, status: VAULTED }, data: { status: item.stockStatus } });
      const credit = sellBackAmount(item.value, sellBackPct);
      await tx.creditEntry.create({ data: { buyerId, kind: "sell-back", amount: credit, ref: `sellback:${item.id}`, note: `${item.name} at ${sellBackPct}% of $${item.value.toFixed(2)}`, createdAt: now } });
      return credit;
    })
    .catch(() => null);
  if (r == null) return { ok: false as const, error: "That single isn't in your vault." };
  return { ok: true as const, credit: r, balance: await creditBalance(buyerId) };
}

/** My side: void a prize still in a vault (lost or damaged card). The card leaves the vault and goes back to its old status. */
export async function cancelVaultItem(itemId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const item = await tx.vaultItem.findFirst({ where: { id: itemId, status: "in_vault", orderId: null } });
    if (!item) return false;
    const flip = await tx.vaultItem.updateMany({ where: { id: item.id, status: "in_vault", orderId: null }, data: { status: "cancelled", updatedAt: now } });
    if (!flip.count) return false;
    await tx.card.updateMany({ where: { id: item.cardId, status: VAULTED }, data: { status: item.stockStatus } });
    return true;
  });
}
