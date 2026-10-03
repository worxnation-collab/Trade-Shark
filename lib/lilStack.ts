import type { Card, LilStack } from "@prisma/client";
import { artUrls } from "./brandArt";
import { db } from "./db";
import { siteUrl } from "./env";
import { LIL_STACK_UNDER, statusAfterPricing } from "./pricing/engine";
import { getSettings } from "./settings";
import { shipForStack, shipFromLink } from "./shipping";
import { createPackLink, deactivatePaymentLink, stripe, stripeErrorMessage, type PaymentLinkApi } from "./stripe";
import { PACK_MIN_PRICE, packLabel, packMath, packPrice } from "./lilStackMath";
import { round2 } from "./util";

/**
 * Lil' Stack: every identified + priced card under $1 goes into a pack instead of selling as a single.
 * - Packs are per batch, up to 12 cards; more qualifying cards make Lil' Stack 2, 3, …
 * - A card sits in at most one pack (Card.lilStackId); the pack keeps its order in cardIds.
 * - Opening a pack is free and shows every card. Buying it is one Stripe Payment Link for the whole pack,
 *   priced at the sum of its cards' list prices rounded up to the dollar, minimum $3.
 * - A pack (and its cards) becomes Sold only from the signed webhook or by hand.
 */
export const LIL_STACK_SIZE = 12;
export { LIL_STACK_UNDER, PACK_MIN_PRICE, packLabel, packMath, packPrice };

/** Statuses a card can be packed from. Ready/Listed/Sold are owner decisions and never get pulled in. */
const PACKABLE = ["Priced", "BulkHold", "LilStack"];

type PackCandidate = Pick<Card, "id" | "status" | "listPrice" | "readable" | "frontImage" | "pile">;

export function qualifies(c: PackCandidate) {
  return (
    PACKABLE.includes(c.status) &&
    c.readable &&
    !!c.frontImage &&
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


const displayName = (c: Pick<Card, "game" | "name" | "player">) => (c.game === "Sports" ? c.player || c.name : c.name) || "Mystery card";

/* ------------------------------------------------------------------ links */

function linkApi(): PaymentLinkApi | null {
  return stripe() as unknown as PaymentLinkApi | null;
}

async function deactivate(pack: Pick<LilStack, "paymentLinkId" | "paymentLinkActive">, api: PaymentLinkApi | null) {
  if (!pack.paymentLinkId || !pack.paymentLinkActive || !api) return;
  try {
    await deactivatePaymentLink(api, pack.paymentLinkId);
  } catch (e) {
    console.error("deactivate pack link failed", e); // Stripe also stops it after one sale; not fatal
  }
}

/**
 * Make sure an open pack has one active link at its current price. `force` replaces the link even when
 * the price matches (the cards inside changed). The old link is expired first and kept in history.
 */
export async function syncPackLink(packId: string, opts: { force?: boolean; api?: PaymentLinkApi | null } = {}) {
  const pack = await db.lilStack.findUnique({ where: { id: packId }, include: { cards: { select: { id: true, name: true, player: true, game: true, listPrice: true, status: true } } } });
  if (!pack || pack.status !== "open") return pack;
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const cards = pack.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const price = packPrice(cards.map((c) => c.listPrice));
  const ship = shipForStack((await getSettings()).buyerShipping);
  const fresh =
    pack.paymentLinkActive && pack.paymentLinkAmount === price && pack.paymentLinkShipMethod === ship.method && pack.paymentLinkShipping === ship.amount && !opts.force;
  if (fresh) return pack.price === price ? pack : db.lilStack.update({ where: { id: pack.id }, data: { price } });

  const api = opts.api !== undefined ? opts.api : linkApi();
  if (!api) return db.lilStack.update({ where: { id: pack.id }, data: { price, linkError: "STRIPE_SECRET_KEY not set: the pack opens for free but has no Buy button yet." } });
  try {
    await deactivate(pack, api);
    const history = [...new Set([...pack.paymentLinkHistory.split(",").filter(Boolean), ...(pack.paymentLinkId ? [pack.paymentLinkId] : [])])].join(",");
    const art = await artUrls().catch(() => ({}) as Record<string, string>);
    const image = "closed" in art && art.closed ? `${siteUrl()}${art.closed}` : null;
    const link = await createPackLink(api, { id: pack.id, price, cardNames: cards.map(displayName), image }, undefined, {
      label: ship.label,
      amount: ship.amount,
      method: ship.method,
    });
    return db.lilStack.update({
      where: { id: pack.id },
      data: {
        price,
        paymentLinkId: link.id,
        paymentLinkUrl: link.url,
        paymentLinkAmount: link.amount,
        paymentLinkActive: true,
        paymentLinkHistory: history,
        paymentLinkShipping: ship.amount,
        paymentLinkShipMethod: ship.method,
        linkError: null,
      },
    });
  } catch (e) {
    return db.lilStack.update({ where: { id: pack.id }, data: { price, paymentLinkActive: false, linkError: stripeErrorMessage(e) } });
  }
}

/* ------------------------------------------------------------------ build */

/**
 * Build or refresh one batch's packs. Stable: cards stay in the pack they're in, so an unchanged pack keeps
 * its pay link. Cards that stopped qualifying come out; new sub-$1 cards fill open packs, then new packs.
 * Sold packs are never touched.
 */
export async function buildLilStacks(batchId: string, opts: { api?: PaymentLinkApi | null } = {}) {
  const s = await getSettings();
  const [cards, packs] = await Promise.all([
    db.card.findMany({
      where: { batchId },
      select: { id: true, status: true, listPrice: true, readable: true, frontImage: true, pile: true },
      orderBy: { pairId: "asc" },
    }),
    db.lilStack.findMany({ where: { batchId }, orderBy: { seq: "asc" } }),
  ]);
  const qualified = cards.filter(qualifies);
  const qIds = new Set(qualified.map((c) => c.id));
  const released = cards.filter((c) => c.status === "LilStack" && !qualifies(c));

  const placed = new Set<string>();
  const plan = packs
    .filter((p) => p.status === "open")
    .map((p) => {
      const ids = p.cardIds.filter((id) => qIds.has(id) && !placed.has(id));
      ids.forEach((id) => placed.add(id));
      return { pack: p, ids, changed: ids.length !== p.cardIds.length };
    });
  const fresh = qualified.map((c) => c.id).filter((id) => !placed.has(id));
  for (const pl of plan)
    while (pl.ids.length < LIL_STACK_SIZE && fresh.length) {
      pl.ids.push(fresh.shift()!);
      pl.changed = true;
    }
  let seq = packs.reduce((n, p) => Math.max(n, p.seq), 0);
  const created = planPacks(fresh).map((ids) => ({ seq: ++seq, ids }));

  const changed = plan.filter((pl) => pl.changed);
  const [, ...rest] = await db.$transaction([
    db.card.updateMany({ where: { id: { in: [...qIds] } }, data: { status: "LilStack" } }),
    ...changed.map((pl) =>
      db.lilStack.update({
        where: { id: pl.pack.id },
        data: { cardIds: pl.ids, cards: { set: pl.ids.map((id) => ({ id })) }, ...(pl.ids.length ? {} : { status: "retired" }) },
      }),
    ),
    ...created.map((c) => db.lilStack.create({ data: { batchId, seq: c.seq, cardIds: c.ids, cards: { connect: c.ids.map((id) => ({ id })) } } })),
    ...released.map((c) => db.card.update({ where: { id: c.id }, data: { status: statusAfterPricing("Priced", c.listPrice, true, s), lilStackId: null } })),
  ]);

  // Pay links: replace where the cards changed, create for new packs, retire emptied ones, fix any missing/stale.
  const api = opts.api !== undefined ? opts.api : linkApi();
  const touched = new Set<string>();
  for (const pl of changed) {
    touched.add(pl.pack.id);
    if (pl.ids.length) await syncPackLink(pl.pack.id, { force: true, api });
    else {
      await deactivate(pl.pack, api);
      await db.lilStack.update({ where: { id: pl.pack.id }, data: { paymentLinkActive: false } });
    }
  }
  const newIds = (rest.slice(changed.length, changed.length + created.length) as LilStack[]).map((p) => p.id);
  for (const id of newIds) {
    touched.add(id);
    await syncPackLink(id, { api });
  }
  for (const pl of plan) if (!touched.has(pl.pack.id) && pl.ids.length) await syncPackLink(pl.pack.id, { api });

  return { batchId, packs: plan.filter((pl) => pl.ids.length).length + created.length, cards: qIds.size, released: released.length };
}

/** Rebuild every batch that has packs or cards that could be packed. */
export async function rebuildAllLilStacks() {
  const batches = await db.batch.findMany({
    where: {
      OR: [{ lilStacks: { some: { status: "open" } } }, { cards: { some: { status: { in: PACKABLE }, listPrice: { lt: LIL_STACK_UNDER } } } }],
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

/** Take one card out of its pack (repriced to $1+, archived…). The pack gets a new link at its new price. */
export async function releaseFromPack(card: Pick<Card, "id" | "lilStackId">) {
  if (!card.lilStackId) return;
  const pack = await db.lilStack.findUnique({ where: { id: card.lilStackId } });
  if (!pack || pack.status !== "open") return; // a sold pack is history; leave it alone
  await db.card.update({ where: { id: card.id }, data: { lilStackId: null } });
  const left = pack.cardIds.filter((id) => id !== card.id);
  if (left.length) {
    await db.lilStack.update({ where: { id: pack.id }, data: { cardIds: left } });
    await syncPackLink(pack.id, { force: true });
  } else {
    await deactivate(pack, linkApi());
    await db.lilStack.update({ where: { id: pack.id }, data: { cardIds: [], status: "retired", paymentLinkActive: false } });
  }
}

/* ------------------------------------------------------------------ sold */

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
  const total = sale.amount ?? pack.paymentLinkAmount ?? pack.price ?? packPrice(cards.map((c) => c.listPrice));
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

/* ----------------------------------------------------------------- public */

/** Only what the public pack page may show: the front, name and set. Never a card's own price. */
export const LIL_STACK_CARD_SELECT = {
  id: true,
  game: true,
  name: true,
  player: true,
  setName: true,
  year: true,
  wowScore: true,
} as const;

export interface PublicPack {
  id: string;
  label: string;
  /** What Stripe charges for the whole pack; null when there's no live link (opening still works). */
  price: number | null;
  buyUrl: string | null;
  /** Shipping line on that link (always a tracked bubble mailer, never free). */
  ship: { amount: number; label: string; free: boolean };
  wow: number;
  cards: { id: string; name: string; setName: string | null }[];
}

export type PackSort = "default" | "price-asc" | "price-desc";

/** Open packs for the shop. Labels follow the default order so "Lil' Stack 2" means the same pack under any sort. */
export async function publicPacks(sort: PackSort = "default"): Promise<PublicPack[]> {
  const fallbackShip = shipForStack((await getSettings()).buyerShipping);
  const packs = await db.lilStack.findMany({
    where: { status: "open" },
    orderBy: [{ batch: { createdAt: "asc" } }, { seq: "asc" }],
    select: {
      id: true,
      cardIds: true,
      paymentLinkActive: true,
      paymentLinkUrl: true,
      paymentLinkAmount: true,
      paymentLinkShipping: true,
      paymentLinkShipMethod: true,
      cards: { where: { status: "LilStack", readable: true }, select: LIL_STACK_CARD_SELECT },
    },
  });
  const out = packs
    .map((p) => {
      const byId = new Map(p.cards.map((c) => [c.id, c]));
      const cards = p.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
      const live = p.paymentLinkActive && !!p.paymentLinkUrl && p.paymentLinkAmount != null;
      return {
        id: p.id,
        price: live ? p.paymentLinkAmount : null,
        buyUrl: live ? p.paymentLinkUrl : null,
        ship: (live && shipFromLink(p.paymentLinkShipMethod, p.paymentLinkShipping)) || fallbackShip,
        wow: cards.reduce((n, c) => Math.max(n, c.wowScore), 0),
        cards: cards.map((c) => ({ id: c.id, name: displayName(c), setName: [c.year, c.setName].filter(Boolean).join(" ") || null })),
      };
    })
    .filter((p) => p.cards.length)
    .map((p, i) => ({ ...p, label: packLabel(i + 1) }));
  if (sort === "default") return out;
  const dir = sort === "price-asc" ? 1 : -1;
  // Packs without a price (no link yet) go last either way.
  return [...out].sort((a, b) => (a.price == null ? 1 : b.price == null ? -1 : dir * (a.price - b.price)));
}
