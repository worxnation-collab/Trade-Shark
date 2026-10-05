import type { Card, LilStack } from "@prisma/client";
import { artUrls } from "./brandArt";
import { db } from "./db";
import { siteUrl } from "./env";
import { CATEGORY_KEYS, categorize, isCategory, productName, type Category } from "./categories";
import { retirePaymentLink } from "./payLink";
import { getSettings } from "./settings";
import { shipForStack, shipFromLink } from "./shipping";
import { createPackLink, deactivatePaymentLink, stripe, stripeErrorMessage, type PaymentLinkApi } from "./stripe";
import { PACK_SIZE, packLabel, packMath, packPrice } from "./lilStackMath";
import { round2 } from "./util";

/**
 * Packs are the only thing the shop sells: Baseball Pack, Football Pack, Pokemon Pack.
 * - A pack is exactly 12 identified, priced cards of one category, built across batches, oldest cards first.
 * - A card sits in at most one pack (Card.lilStackId); the pack keeps its order in cardIds.
 *   (Tables keep their old Lil' Stack names; a "LilStack" status means "in a pack".)
 * - Pack price = the sum of its cards' existing prices. One Stripe Payment Link per pack, plus the mailer line.
 * - Opening a pack is free and shows all 12 cards. A pack (and its cards) becomes Sold only from the signed
 *   webhook or by hand.
 */
export { PACK_SIZE, packLabel, packMath, packPrice };
/** Kept for older imports: the pack size. */
export const LIL_STACK_SIZE = PACK_SIZE;

/** Statuses a card can be packed from. Needs a look, Inbox, Sold and Archived never get pulled in. */
export const PACKABLE = ["Priced", "BulkHold", "LilStack"];

type PackCandidate = Pick<Card, "status" | "listPrice" | "readable" | "frontImage" | "category">;

export function qualifies(c: PackCandidate, category: string) {
  return PACKABLE.includes(c.status) && c.readable && !!c.frontImage && c.listPrice != null && c.category === category;
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
  // No way to make the right link: the old one (wrong cards or price) must not stay buyable.
  if (!api) return db.lilStack.update({ where: { id: pack.id }, data: { price, paymentLinkActive: false, linkError: "STRIPE_SECRET_KEY not set: the pack opens but has no Buy button yet." } });
  try {
    await deactivate(pack, api);
    const history = [...new Set([...pack.paymentLinkHistory.split(",").filter(Boolean), ...(pack.paymentLinkId ? [pack.paymentLinkId] : [])])].join(",");
    const art = await artUrls().catch(() => ({}) as Record<string, string>);
    const image = "closed" in art && art.closed ? `${siteUrl()}${art.closed}` : null;
    const link = await createPackLink(api, { id: pack.id, price, cardNames: cards.map(displayName), image, name: `${productName(pack.category)}, Trade Shark` }, undefined, {
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
 * The packing plan for one category (pure). `open` = open packs oldest first, `ids` = every card that may be
 * packed, oldest first. Packs keep the cards they still may hold; a short pack refills from the free cards;
 * one that can't reach 12 dissolves. Free cards then make new packs, 12 at a time; the rest wait in stock.
 */
export function planCategory<P extends { id: string; cardIds: string[] }>(open: P[], ids: string[], size = PACK_SIZE) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const placed = new Set<string>();
  const plan = open.map((p) => {
    const keep = p.cardIds.filter((id) => rank.has(id) && !placed.has(id));
    keep.forEach((id) => placed.add(id));
    return { pack: p, ids: keep, changed: keep.length !== p.cardIds.length };
  });
  let pool = ids.filter((id) => !placed.has(id));
  for (const pl of plan)
    while (pl.ids.length < size && pool.length) {
      pl.ids.push(pool.shift()!);
      pl.changed = true;
    }
  const kept = plan.filter((pl) => pl.ids.length === size);
  const dissolved = plan.filter((pl) => pl.ids.length < size);
  pool = [...pool, ...dissolved.flatMap((pl) => pl.ids)].sort((a, b) => rank.get(a)! - rank.get(b)!);
  const created = planPacks(pool.slice(0, pool.length - (pool.length % size)), size);
  return { kept, dissolved, created, waiting: pool.slice(created.length * size) };
}

/**
 * Build or refresh one category's packs. Stable: cards stay in the pack they're in, so an unchanged pack keeps
 * its pay link. A pack that lost cards refills from stock; if stock can't bring it back to 12 it dissolves and
 * its cards go back to stock. New packs are made 12 at a time, oldest cards first. Sold packs are never touched.
 */
export async function buildPacks(category: Category, opts: { api?: PaymentLinkApi | null } = {}) {
  const sel = { id: true, status: true, listPrice: true, readable: true, frontImage: true, category: true, lilStackId: true } as const;
  const [cards, packs] = await Promise.all([
    db.card.findMany({ where: { category, status: { in: PACKABLE } }, select: sel, orderBy: [{ createdAt: "asc" }, { pairId: "asc" }] }),
    db.lilStack.findMany({ where: { category }, orderBy: { seq: "asc" } }),
  ]);
  const open = packs.filter((p) => p.status === "open");
  const qualified = cards.filter((c) => qualifies(c, category));
  const qualifiedIds = new Set(qualified.map((c) => c.id));
  // Members that stopped qualifying (moved category, set aside…) leave, unless another pack already took them.
  const members = await db.card.findMany({ where: { lilStackId: { in: open.map((p) => p.id) } }, select: sel });
  const released = members.filter((c) => !qualifiedIds.has(c.id));

  const { kept, dissolved, created: newIds, waiting } = planCategory(open, qualified.map((c) => c.id));
  let seq = packs.reduce((n, p) => Math.max(n, p.seq), 0);
  const created = newIds.map((ids) => ({ seq: ++seq, ids }));
  const packedIds = [...kept.flatMap((pl) => pl.ids), ...newIds.flat()];
  const changed = kept.filter((pl) => pl.changed);

  const [, , ...rest] = await db.$transaction([
    db.card.updateMany({ where: { id: { in: packedIds } }, data: { status: "LilStack" } }),
    db.card.updateMany({ where: { id: { in: [...waiting, ...released.map((c) => c.id)] }, status: "LilStack" }, data: { status: "Priced" } }),
    ...changed.map((pl) => db.lilStack.update({ where: { id: pl.pack.id }, data: { cardIds: pl.ids, cards: { set: pl.ids.map((id) => ({ id })) } } })),
    ...created.map((c) => db.lilStack.create({ data: { category, seq: c.seq, cardIds: c.ids, cards: { connect: c.ids.map((id) => ({ id })) } } })),
    ...dissolved.map((pl) => db.lilStack.update({ where: { id: pl.pack.id }, data: { status: "retired", cardIds: [], cards: { set: [] }, paymentLinkActive: false } })),
    // Stock cards belong to no pack (dissolved packs already let go of theirs above).
    db.card.updateMany({ where: { id: { in: waiting }, lilStackId: { not: null }, lilStack: { status: "open" } }, data: { lilStackId: null } }),
    ...released.map((c) => db.card.updateMany({ where: { id: c.id, lilStackId: c.lilStackId }, data: { lilStackId: null } })),
  ]);

  // Pay links: replace where the cards changed, create for new packs, expire dissolved ones, fix any stale.
  const api = opts.api !== undefined ? opts.api : linkApi();
  for (const pl of dissolved) await deactivate(pl.pack, api);
  for (const pl of changed) await syncPackLink(pl.pack.id, { force: true, api });
  const newPacks = (rest.slice(changed.length, changed.length + created.length) as LilStack[]).map((p) => p.id);
  for (const id of newPacks) await syncPackLink(id, { api });
  for (const pl of kept) if (!pl.changed) await syncPackLink(pl.pack.id, { api });

  return { category, packs: kept.length + created.length, packed: packedIds.length, waiting: waiting.length, dissolved: dissolved.length };
}

/**
 * Sort cards into categories (unless I set one by hand), retire what the old shop sold
 * (single-card listings, per-batch Lil' Stacks), then build every category's packs.
 */
export async function rebuildAllPacks(opts: { api?: PaymentLinkApi | null } = {}) {
  const api = opts.api !== undefined ? opts.api : linkApi();
  const auto = await db.card.findMany({
    where: { OR: [{ categorySource: null }, { categorySource: "auto" }], status: { notIn: ["Sold", "Archived"] } },
    select: { id: true, game: true, team: true, setName: true, title: true, variant: true, category: true },
  });
  const moves = auto.map((c) => ({ id: c.id, to: categorize(c), from: c.category })).filter((m) => m.to !== m.from);
  if (moves.length) await db.$transaction(moves.map((m) => db.card.update({ where: { id: m.id }, data: { category: m.to, categorySource: "auto" } })));

  // Single cards are no longer products: expire their pay links and put them back in stock.
  const singles = await db.card.findMany({ where: { status: "Ready" } });
  for (const c of singles) {
    await retirePaymentLink(c);
    await db.card.update({ where: { id: c.id }, data: { status: "Priced" } });
  }
  // Packs from before categories (per-batch Lil' Stacks): expire and dissolve.
  const legacy = await db.lilStack.findMany({ where: { status: "open", category: null } });
  for (const p of legacy) {
    await deactivate(p, api);
    await db.$transaction([
      db.card.updateMany({ where: { lilStackId: p.id, status: "LilStack" }, data: { status: "Priced" } }),
      db.lilStack.update({ where: { id: p.id }, data: { status: "retired", cardIds: [], cards: { set: [] }, paymentLinkActive: false } }),
    ]);
  }
  const results = [];
  for (const cat of CATEGORY_KEYS) results.push(await buildPacks(cat, { api }));
  return { sorted: moves.length, singlesRetired: singles.length, legacyRetired: legacy.length, categories: results };
}

/** Take one card out of its pack (sold or pulled by hand, recategorized…); the pack refills from stock or dissolves. */
export async function releaseFromPack(card: Pick<Card, "id" | "lilStackId">) {
  if (!card.lilStackId) return;
  const pack = await db.lilStack.findUnique({ where: { id: card.lilStackId } });
  if (!pack || pack.status !== "open") return; // a sold pack is history; leave it alone
  await db.card.update({ where: { id: card.id }, data: { lilStackId: null } });
  await db.lilStack.update({ where: { id: pack.id }, data: { cardIds: pack.cardIds.filter((id) => id !== card.id) } });
  if (isCategory(pack.category)) await buildPacks(pack.category);
  else {
    await deactivate(pack, linkApi());
    await db.lilStack.update({ where: { id: pack.id }, data: { status: "retired", paymentLinkActive: false } });
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
export const PACK_CARD_SELECT = {
  id: true,
  game: true,
  name: true,
  player: true,
  setName: true,
  year: true,
} as const;

export interface PublicPack {
  id: string;
  label: string;
  /** What Stripe charges for the whole pack (the sum of its cards); null when there's no live link. */
  price: number | null;
  buyUrl: string | null;
  /** Shipping line on that link (always a tracked bubble mailer, never free). */
  ship: { amount: number; label: string; free: boolean };
  cards: { id: string; name: string; setName: string | null }[];
}

export type PackSort = "default" | "price-asc" | "price-desc";

/** One category's open packs. Labels follow pack age so "Pokemon Pack #2" means the same pack under any sort. */
export async function publicPacks(category: Category, sort: PackSort = "default"): Promise<PublicPack[]> {
  const fallbackShip = shipForStack((await getSettings()).buyerShipping);
  const packs = await db.lilStack.findMany({
    where: { status: "open", category },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      cardIds: true,
      paymentLinkActive: true,
      paymentLinkUrl: true,
      paymentLinkAmount: true,
      paymentLinkShipping: true,
      paymentLinkShipMethod: true,
      cards: { where: { status: "LilStack", readable: true }, select: PACK_CARD_SELECT },
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
        cards: cards.map((c) => ({ id: c.id, name: displayName(c), setName: [c.year, c.setName].filter(Boolean).join(" ") || null })),
      };
    })
    .filter((p) => p.cards.length === PACK_SIZE)
    .map((p, i) => ({ ...p, label: packLabel(category, i + 1) }));
  if (sort === "default") return out;
  const dir = sort === "price-asc" ? 1 : -1;
  return [...out].sort((a, b) => (a.price == null ? 1 : b.price == null ? -1 : dir * (a.price - b.price)));
}

/** The three products for the catalog: how many packs each has and their price range. */
export async function catalog() {
  const open = await db.lilStack.findMany({
    where: { status: "open", category: { in: CATEGORY_KEYS }, paymentLinkActive: true },
    select: { category: true, paymentLinkAmount: true, cardIds: true },
  });
  return CATEGORY_KEYS.map((key) => {
    const mine = open.filter((p) => p.category === key && p.cardIds.length === PACK_SIZE);
    const prices = mine.map((p) => p.paymentLinkAmount ?? 0).filter((n) => n > 0);
    return { key, product: productName(key), packs: mine.length, low: prices.length ? Math.min(...prices) : null, high: prices.length ? Math.max(...prices) : null };
  });
}
