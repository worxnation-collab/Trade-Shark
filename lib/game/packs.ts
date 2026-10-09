import type { Prisma } from "@prisma/client";
import { CATEGORY_KEYS, type Category } from "../categories";
import { db } from "../db";
import { getSettings } from "../settings";
import { fitsReserve } from "../partners/split";
import { BIN, CHASE_RESERVE_CAP, SLOTS, cryptoRng, drawPack, isBump, nextKind, round2, showable, shortages, slotOf, type PackKind, type PoolCard, type Rng } from "./rules";

/**
 * Built packs for the reveal game, per category. Packs are drawn ahead of time from stock, so a purchase only
 * ever reserves a pack that already exists; it never assembles one on the spot.
 */

/** Cards that may be drawn: identified, priced, upright stock with a photo, tagged to an owner, sorted into a tray slot, not in any pack. */
export const STOCK = ["Priced", "BulkHold"];
/** Keep up to this many available packs per category (more stock stays loose for later draws). */
export const AVAILABLE_TARGET = 50;

/** Energy cards (basic, special, anything named Energy) never go in a pack: they wait in the desk's side bin. */
export const isEnergy = (name?: string | null) => /\benergy\b/i.test(name ?? "");

const poolWhere = (category: string): Prisma.CardWhereInput => ({
  category,
  status: { in: STOCK },
  readable: true,
  frontImage: { not: null },
  listPrice: { not: null },
  location: { not: null },
  OR: [{ partnerId: { not: null } }, { senderId: { not: null } }],
  gamePackId: null,
  lilStackId: null,
  NOT: { name: { contains: "energy", mode: "insensitive" } },
});

/** A new drop is members-only for this long. */
export const EARLY_ACCESS_MS = 60 * 60 * 1000;

/** Stock, by bin, for one category. Chase-priced cards wait on the chase list until that flag is on. */
export async function bins(category: Category) {
  const cards = await db.card.findMany({ where: poolWhere(category), select: { id: true, listPrice: true } });
  const out = { bulk: 0, mid: 0, top: 0, bump: 0, hit: 0, chase: 0 };
  for (const c of cards) {
    const s = slotOf(c.listPrice);
    if (s) out[s]++;
    if (isBump(c.listPrice)) out.bump++; // also counted in top: member stacks draw from these
  }
  return { ...out, short: shortages(cards.map((c) => ({ id: c.id, price: c.listPrice! }))) };
}

/** Kinds of the packs built in a category, newest first (the mix window). Dissolved packs never counted. */
async function recentKinds(category: string) {
  const rows = await db.gamePack.findMany({ where: { category, status: { not: "dissolved" } }, orderBy: { builtAt: "desc" }, take: 99, select: { kind: true } });
  return rows.map((r) => r.kind as PackKind);
}

/** Tray letters on the desk, one per value bin (H = hold: needs a look, no owner, chase off, reserve can't cover). */
export const TRAY = { bulk: "A", mid: "B", top: "C", hit: "D", hold: "H", unpriced: "U", energy: "E" } as const;
/** How many packs one press of the desk button builds. */
export const BUILD_BATCH = 10;

/** Everything the planner needs, loaded once. */
async function buildContext(category: Category) {
  const settings = await getSettings();
  const rows = await db.card.findMany({
    where: poolWhere(category),
    select: { id: true, listPrice: true, partnerId: true, senderId: true, catalogId: true, name: true, setName: true, number: true, player: true, game: true, cardType: true },
    orderBy: { createdAt: "asc" },
  });
  const { reserveNow } = await import("../partners");
  const queued = await db.gamePack.findMany({ where: { category, status: { in: ["available", "pulling"] } }, select: { kind: true } });
  return {
    chaseOn: !!settings.chaseOn?.[category],
    headroom: settings.consignOpen ? (await reserveNow()).headroom : 0,
    rows,
    recent: await recentKinds(category),
    ready: { total: queued.length, hit: queued.filter((p) => p.kind === "hit").length },
  };
}
type BuildContext = Awaited<ReturnType<typeof buildContext>>;

const identOf = (c: BuildContext["rows"][number]) => c.catalogId || [c.name, c.setName, c.number].map((x) => (x ?? "").trim().toLowerCase()).join("|");

/**
 * Plan up to `count` legal packs from what's sorted into the trays, without touching the database.
 * Mix from `nextKind` (80 / 18 / 2), a hit or chase that can't be drawn falls back to base; consignment cards only
 * inside the reserve's headroom. Also reports what's missing and why draws were thrown out, for the desk.
 */
export function planPacks(ctx: BuildContext, count: number, rng: Rng = cryptoRng) {
  const ownerOf = new Map(ctx.rows.map((c) => [c.id, c]));
  const left = new Map<string, PoolCard>(
    ctx.rows.map((c) => [c.id, { id: c.id, price: c.listPrice!, ident: identOf(c), type: c.game === "Pokemon" ? c.cardType : null, player: c.game === "Sports" ? c.player : null }]),
  );
  const consigned = (ids: string[]) => ids.map((id) => ownerOf.get(id)!).filter((c) => c.senderId).map((c) => c.listPrice!);
  let headroom = ctx.headroom;
  const recent = [...ctx.recent];
  const ready = { ...ctx.ready };
  const why = new Map<string, number>();
  const packs: { kind: "base" | "hit" | "chase"; ids: string[]; value: number; best: string }[] = [];
  while (packs.length < count) {
    const pool = [...left.values()].filter((c) => !ownerOf.get(c.id)!.senderId || c.price <= headroom);
    const has = (bin: string) => pool.some((c) => slotOf(c.price) === bin);
    let kind = nextKind({ recent, ready, hitCards: has("hit"), chaseOn: ctx.chaseOn, chaseCards: has("chase") });
    let p = drawPack(pool, rng, 400, kind, why);
    if (!p && kind !== "base") {
      kind = "base";
      p = drawPack(pool, rng, 400, "base", why);
    }
    // The reserve must cover every consignment card in this stack together; if not, draw it from founder cards only.
    if (p && !fitsReserve(consigned(p.ids), headroom)) {
      const founders = pool.filter((c) => !ownerOf.get(c.id)!.senderId);
      p = drawPack(founders, rng, 400, kind, why) ?? (kind !== "base" ? ((kind = "base"), drawPack(founders, rng, 400, "base", why)) : null);
    }
    if (!p) break;
    packs.push({ kind, ...p });
    p.ids.forEach((id) => left.delete(id));
    headroom = Math.max(0, Math.round((headroom - consigned(p.ids).reduce((a, b) => a + b, 0)) * 100) / 100);
    recent.unshift(kind);
    ready.total++;
    if (kind === "hit") ready.hit++;
  }
  // What the trays still need for the packs that couldn't be drawn (as base packs).
  const short = count - packs.length;
  const have = { bulk: 0, mid: 0, top: 0 };
  for (const c of left.values()) {
    const b = slotOf(c.price);
    if (b === "bulk" || b === "mid" || b === "top") have[b]++;
  }
  const missing = short
    ? (Object.keys(SLOTS) as (keyof typeof SLOTS)[]).map((s) => ({ slot: s, need: Math.max(0, SLOTS[s] * short - have[s]) })).filter((m) => m.need > 0)
    : [];
  return { packs, missing, rejected: [...why.entries()].sort((a, b) => b[1] - a[1]) };
}

/** One line on what stops the next packs: missing cards per bin, or the rule that kept throwing draws out. */
export function shortLine(plan: ReturnType<typeof planPacks>, count = BUILD_BATCH) {
  if (plan.packs.length >= count) return null;
  const parts = plan.missing.map((m) => `${m.need} more ${m.slot}`);
  const rule = plan.rejected[0] ? `draws rejected for ${plan.rejected[0][0]}` : null;
  if (!parts.length && !rule) return `the cards in the trays don't add up to a pack worth $3.20–$3.80`;
  return [parts.length ? `need ${parts.join(", ")}` : null, rule].filter(Boolean).join("; ");
}

/** How many legal packs the trays allow right now (up to `count`), without building them. */
export async function previewBuild(category: Category, count = BUILD_BATCH) {
  return planPacks(await buildContext(category), count);
}

/**
 * Build packs from the trays and list them for sale right away (members' first hour): the 12 cards are reserved to
 * the pack, so no two buyers can get the same card. The founder pulls the stack later (Packed). Called by `autoList`.
 */
export async function buildGamePacks(category: Category, opts: { rng?: Rng; count?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const ctx = await buildContext(category);
  const room = Math.max(0, AVAILABLE_TARGET - ctx.ready.total);
  const plan = planPacks(ctx, Math.min(opts.count ?? BUILD_BATCH, room), opts.rng);
  const ownerOf = new Map(ctx.rows.map((c) => [c.id, c]));
  let number = (await db.gamePack.aggregate({ where: { category }, _max: { number: true } }))._max.number ?? 0;
  const kinds: Record<string, number> = {};
  let built = 0;
  for (const draw of plan.packs) {
    number++;
    // Claim the cards only if they're still free (a save or another build may have taken one).
    const ok = await db
      .$transaction(async (tx) => {
        const pack = await tx.gamePack.create({
          data: {
            category,
            number,
            kind: draw.kind,
            status: "available",
            cardIds: draw.ids,
            partnerIds: [...new Set(draw.ids.map((id) => ownerOf.get(id)!.partnerId).filter((x): x is string => !!x))].sort(),
            senderIds: [...new Set(draw.ids.map((id) => ownerOf.get(id)!.senderId).filter((x): x is string => !!x))].sort(),
            value: draw.value,
            hitCardId: draw.kind === "base" ? null : draw.best,
            chase: draw.kind === "chase",
            chaseCardId: draw.kind === "chase" ? draw.best : null,
            publicAt: new Date(now.getTime() + EARLY_ACCESS_MS), // a new drop: members first
          },
        });
        const n = await tx.card.updateMany({ where: { id: { in: draw.ids }, gamePackId: null, status: { in: STOCK } }, data: { gamePackId: pack.id, status: "LilStack" } });
        if (n.count !== draw.ids.length) throw new Error("card taken");
        return true;
      })
      .catch(() => false);
    if (!ok) {
      number = (await db.gamePack.aggregate({ where: { category }, _max: { number: true } }))._max.number ?? number;
      continue;
    }
    built++;
    kinds[draw.kind] = (kinds[draw.kind] ?? 0) + 1;
  }
  return { category, built, kinds, short: shortLine(plan, Math.min(opts.count ?? BUILD_BATCH, room)), full: room === 0 };
}

/** States in which a listed pack still exists physically as a stack to pull (for sale, held, or bought). */
export const LIVE_PACK = ["available", "reserved", "kept", "sold-blind", "sold-facebook"];

/** The founder pulled this stack (Packed). It doesn't change whether the pack is for sale. */
export async function markPacked(packId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const n = await tx.gamePack.updateMany({ where: { id: packId, packedAt: null, status: { in: LIVE_PACK } }, data: { packedAt: now } });
    if (!n.count) return false;
    await tx.card.updateMany({ where: { gamePackId: packId }, data: { pulledAt: now } });
    return true;
  });
}

export async function releasePack(packId: string, status: "expired" | "dissolved", from: string[] = ["available", "reserved"]) {
  return db.$transaction(async (tx) => {
    const n = await tx.gamePack.updateMany({ where: { id: packId, status: { in: from } }, data: { status, closedAt: new Date() } });
    if (!n.count) return false;
    // Cards already pulled for this pack are in its bag, not their slots: they show under "Put back" until re-shelved.
    await tx.card.updateMany({ where: { gamePackId: packId, status: "LilStack", pulledAt: { not: null } }, data: { gamePackId: null, status: "Priced", sortedAt: null, pulledAt: null } });
    await tx.card.updateMany({ where: { gamePackId: packId, status: "LilStack" }, data: { gamePackId: null, status: "Priced" } });
    return true;
  });
}

/** A card I edited (price, category, pulled…) leaves its pack: an available pack dissolves; reserved/sold ones are left alone. */
export async function releaseCardFromGame(card: { gamePackId: string | null }) {
  if (!card.gamePackId) return;
  await releasePack(card.gamePackId, "dissolved", ["available", "pulling"]);
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
 * Reserve one ready pack for a player, at random. Peek and blind use this same call and the same queue, so they
 * share packs and odds. A new drop is members-only for its first hour. Only one chase pack per category can be
 * reserved at a time. `memberStack`: the member's monthly stack, a base pack with its top slot bumped to $2–$4.
 */
export async function reservePack(category: Category, buyerId: string, opts: { rng?: Rng; member?: boolean; memberStack?: boolean; now?: Date } = {}) {
  const rng = opts.rng ?? cryptoRng;
  const now = opts.now ?? new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    const chaseBusy = (await db.gamePack.count({ where: { category, status: "reserved", kind: "chase" } })) >= CHASE_RESERVE_CAP;
    const candidates = (
      await db.gamePack.findMany({
        where: { category, status: "available", ...(opts.member ? {} : { publicAt: { lte: now } }) },
        select: { id: true, value: true, kind: true },
      })
    ).filter((p) => showable(p) && !(chaseBusy && p.kind === "chase") && (!opts.memberStack || p.kind === "base"));
    if (!candidates.length) return null;
    const pick = candidates[rng(candidates.length)];
    const n = await db.gamePack.updateMany({ where: { id: pick.id, status: "available" }, data: { status: "reserved", reservedBy: buyerId, reservedAt: now } });
    if (!n.count) continue; // someone else got it first
    const bumped = opts.memberStack ? await bumpTopSlot(pick.id, category, rng) : false;
    return { pack: await db.gamePack.findUniqueOrThrow({ where: { id: pick.id } }), bumped };
  }
  return null;
}

/** The member stack: swap the top-slot card of a just-reserved base pack for a better $2.01–$3.99 card from stock. */
async function bumpTopSlot(packId: string, category: Category, rng: Rng) {
  const current = await db.gamePack.findUniqueOrThrow({ where: { id: packId }, include: { cards: { select: { id: true, listPrice: true } } } });
  const top = current.cards.reduce<(typeof current.cards)[number] | null>((a, c) => (!a || (c.listPrice ?? 0) > (a.listPrice ?? 0) ? c : a), null);
  if (!top) return false;
  const pool = (await db.card.findMany({ where: poolWhere(category), select: { id: true, listPrice: true, partnerId: true } })).filter((c) => isBump(c.listPrice) && c.listPrice! > (top.listPrice ?? 0) && !!c.partnerId); // founder cards only: no reserve check at reservation
  if (!pool.length) return false;
  const card = pool[rng(pool.length)];
  return db
    .$transaction(async (tx) => {
      const pack = await tx.gamePack.findUniqueOrThrow({ where: { id: packId }, include: { cards: { select: { id: true, listPrice: true, partnerId: true } } } });
      const took = await tx.card.updateMany({ where: { id: card.id, gamePackId: null, status: { in: STOCK } }, data: { gamePackId: packId, status: "LilStack" } });
      if (!took.count) throw new Error("bump card taken");
      await tx.card.update({ where: { id: top.id }, data: { gamePackId: null, status: "Priced" } });
      const cardIds = pack.cardIds.map((id) => (id === top.id ? card.id : id));
      const value = round2(pack.cards.reduce((n, c) => n + (c.id === top.id ? card.listPrice! : c.listPrice ?? 0), 0));
      const partnerIds = [...new Set([...pack.cards.filter((c) => c.id !== top.id).map((c) => c.partnerId), card.partnerId].filter((x): x is string => !!x))].sort();
      await tx.gamePack.update({ where: { id: packId }, data: { cardIds, partnerIds, value, kind: "member", hitCardId: card.id } });
      return true;
    })
    .catch(() => false);
}

/** Chase on/off for a category. Off: ready chase packs are taken apart (a reserved one finishes its 30 s). */
export async function setChase(category: Category, on: boolean) {
  const { saveSettings } = await import("../settings");
  const s = await getSettings();
  if (on && !(await chaseList(category)).length) throw new Error("Scan at least one card priced $10 or more in this category first.");
  await saveSettings({ chaseOn: { ...s.chaseOn, [category]: on } });
  if (!on) for (const p of await db.gamePack.findMany({ where: { category, status: { in: ["available", "pulling"] }, kind: "chase" }, select: { id: true } })) await releasePack(p.id, "dissolved", ["available", "pulling"]);
}

/** Whether a new game can start in a category (members see a new drop an hour early), and when it opens to everyone. */
export async function categoryStatus(category: Category, member = false, now = new Date()) {
  const s = await getSettings();
  const ready = (await db.gamePack.findMany({ where: { category, status: "available" }, select: { value: true, kind: true, publicAt: true } })).filter(showable);
  const pub = ready.filter((p) => p.publicAt <= now);
  const early = ready.filter((p) => p.publicAt > now);
  const available = member ? ready.length : pub.length;
  return {
    category,
    available,
    open: available > 0,
    chaseOn: !!s.chaseOn?.[category],
    earlyCount: early.length,
    opensAt: !pub.length && early.length ? new Date(Math.min(...early.map((p) => p.publicAt.getTime()))) : null,
  };
}

/** The 12 cards a player may see for a pack: name, set, engine price, in pack order. */
export async function packView(packId: string) {
  const pack = await db.gamePack.findUniqueOrThrow({
    where: { id: packId },
    include: { cards: { select: { id: true, game: true, name: true, player: true, setName: true, year: true, number: true, variant: true, listPrice: true } } },
  });
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const cards = pack.cardIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      id: c.id,
      name: (c.game === "Sports" ? c.player || c.name : c.name) || "Mystery card",
      setName: [c.year, c.setName].filter(Boolean).join(" ") || null,
      number: c.number || null,
      variant: c.variant || null,
      price: c.listPrice ?? 0,
      chase: c.id === pack.chaseCardId,
      hit: c.id === pack.hitCardId && pack.kind === "hit",
      bumped: c.id === pack.hitCardId && pack.kind === "member",
    }))
    .sort((a, b) => a.price - b.price); // best card last: the reveal builds to it
  return { id: pack.id, number: pack.number, kind: pack.kind, category: pack.category, value: pack.value, chase: pack.chase, cards };
}
export type PackView = Awaited<ReturnType<typeof packView>>;

/**
 * A Facebook sale, marked by a founder (Marketplace is never read automatically). Reserves the next ready stack in the
 * category exactly like a blind buy (same queue, at random), takes it off the site, and marks it sold-facebook.
 * It never returns to ready unless that Facebook order is voided.
 */
export async function sellOnFacebook(category: Category, now = new Date()) {
  const got = await reservePack(category, "facebook", { member: true, now });
  if (!got) return null;
  await db.$transaction([
    db.gamePack.update({ where: { id: got.pack.id }, data: { status: "sold-facebook", closedAt: now } }),
    db.card.updateMany({ where: { gamePackId: got.pack.id }, data: { status: "Sold", soldChannel: "facebook", soldAt: now } }),
  ]);
  return got.pack;
}

/** Void a Facebook order: the stack goes back on the site as it was (same cards, same number). */
export async function voidFacebookSale(packId: string) {
  return db.$transaction(async (tx) => {
    const n = await tx.gamePack.updateMany({ where: { id: packId, status: "sold-facebook" }, data: { status: "available", closedAt: null, reservedBy: null, reservedAt: null } });
    if (!n.count) return false;
    await tx.card.updateMany({ where: { gamePackId: packId }, data: { status: "LilStack", soldChannel: null, soldAt: null } });
    return true;
  });
}
