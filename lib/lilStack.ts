import type { LilStack } from "@prisma/client";
import { CATEGORY_KEYS, categorize } from "./categories";
import { db } from "./db";
import { buildAllGamePacks } from "./game/packs";
import { retirePaymentLink } from "./payLink";
import { deactivatePaymentLink, stripe, type PaymentLinkApi } from "./stripe";
import { round2 } from "./util";

/**
 * Before the reveal game, packs sold on Stripe Payment Links (the LilStack table). That's retired: the game
 * (lib/game/*) sells packs now. What's left here: sorting cards into categories, retiring the old links, and the
 * webhook bits so a sale on an old link still lands.
 */

function linkApi(): PaymentLinkApi | null {
  return stripe() as unknown as PaymentLinkApi | null;
}

async function deactivate(pack: Pick<LilStack, "paymentLinkId" | "paymentLinkActive">, api: PaymentLinkApi | null) {
  if (!pack.paymentLinkId || !pack.paymentLinkActive || !api) return;
  try {
    await deactivatePaymentLink(api, pack.paymentLinkId);
  } catch (e) {
    console.error("deactivate pack link failed", e);
  }
}

/** Sort cards into categories (unless I set one by hand). Returns how many moved. */
export async function categorizeAll() {
  const auto = await db.card.findMany({
    where: { OR: [{ categorySource: null }, { categorySource: "auto" }], status: { notIn: ["Sold", "Archived"] } },
    select: { id: true, game: true, team: true, setName: true, title: true, variant: true, category: true, gamePackId: true },
  });
  const moves = auto.map((c) => ({ id: c.id, to: categorize(c), from: c.category })).filter((m) => m.to !== m.from);
  if (moves.length) await db.$transaction(moves.map((m) => db.card.update({ where: { id: m.id }, data: { category: m.to, categorySource: "auto" } })));
  return moves.length;
}

/** Expire every old Payment Link (single cards and Lil' Stack packs) and put their cards back in stock. */
export async function retireOldLinks(api: PaymentLinkApi | null = linkApi()) {
  const singles = await db.card.findMany({ where: { status: { in: ["Ready", "Listed"] }, paymentLinkActive: true } });
  for (const c of singles) {
    await retirePaymentLink(c);
    await db.card.update({ where: { id: c.id }, data: { status: "Priced" } });
  }
  const old = await db.lilStack.findMany({ where: { status: "open" } });
  for (const p of old) {
    await deactivate(p, api);
    await db.$transaction([
      db.card.updateMany({ where: { lilStackId: p.id, status: "LilStack" }, data: { status: "Priced" } }),
      db.card.updateMany({ where: { lilStackId: p.id }, data: { lilStackId: null } }),
      db.lilStack.update({ where: { id: p.id }, data: { status: "retired", paymentLinkActive: false } }),
    ]);
  }
  return { singles: singles.length, packs: old.length };
}

/** After a batch, a reprice, or by hand: sort, retire old links, then draw new game packs from stock. */
export async function refreshPacks() {
  const sorted = await categorizeAll();
  const retired = await retireOldLinks();
  const built = await buildAllGamePacks({ drop: true }); // a new drop: members get the first hour
  return { sorted, retired, built, categories: CATEGORY_KEYS };
}

/* ------------------------------------------------------- old link sales */

/** Split the pack's sale across its cards by list price, so each card's soldPrice adds up to the total. */
export function splitSale(total: number, prices: number[]) {
  const sum = prices.reduce((n, p) => n + p, 0);
  const shares = prices.map((p) => (sum > 0 ? round2((total * p) / sum) : round2(total / prices.length)));
  if (shares.length) shares[shares.length - 1] = round2(total - shares.slice(0, -1).reduce((n, x) => n + x, 0));
  return shares;
}

/**
 * Mark a pack and every card in it Sold. Called by the signed Stripe webhook, or by me by hand.
 * Idempotent: an already-sold pack changes nothing.
 */
export async function markPackSold(
  packId: string,
  sale: {
    amount?: number | null; // merchandise only; shipping is its own field
    at?: Date;
    sessionId?: string | null;
    channel: string;
    byHand?: boolean;
    shippingCharged?: number | null;
    shipMethod?: string | null;
    shipTo?: string | null;
  },
) {
  const pack = await db.lilStack.findUnique({ where: { id: packId }, include: { cards: { select: { id: true, listPrice: true, status: true } } } });
  if (!pack) return { ok: false as const, note: "no such pack" };
  if (pack.status === "sold") return { ok: true as const, note: "already sold" };
  if (sale.byHand) await deactivate(pack, linkApi()); // Stripe only stops the link itself after a Stripe sale
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const cards = pack.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && c.status === "LilStack");
  const total = sale.amount ?? pack.paymentLinkAmount ?? pack.price ?? round2(cards.reduce((n, c) => n + (c.listPrice ?? 0), 0));
  const shares = splitSale(total, cards.map((c) => c.listPrice ?? 0));
  const at = sale.at ?? new Date();
  await db.$transaction([
    db.lilStack.update({
      where: { id: pack.id },
      data: {
        status: "sold",
        soldAt: at,
        soldPrice: total,
        stripeSessionId: sale.sessionId ?? null,
        paymentLinkActive: false,
        shippingCharged: sale.shippingCharged ?? null,
        shipMethod: sale.shipMethod ?? pack.paymentLinkShipMethod ?? "bubble",
        shipTo: sale.shipTo ?? null,
      },
    }),
    ...cards.map((c, i) =>
      db.card.update({
        where: { id: c.id },
        data: { status: "Sold", soldPrice: shares[i], soldChannel: sale.channel, soldAt: at, stripeSessionId: sale.sessionId ?? null },
      }),
    ),
  ]);
  return { ok: true as const, note: `sold pack ${pack.id} (${cards.length} cards)` };
}

/** The pack a Payment Link belongs to, current or earlier link. */
export async function packForLink(linkId: string) {
  return (
    (await db.lilStack.findFirst({ where: { paymentLinkId: linkId } })) ??
    (await db.lilStack.findMany({ where: { paymentLinkHistory: { contains: linkId } } })).find((p) => p.paymentLinkHistory.split(",").includes(linkId)) ??
    null
  );
}

