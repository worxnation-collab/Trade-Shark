import { db } from "../db";
import { siteUrl } from "../env";
import { PRICES } from "../game/rules";
import { stripe, stripeErrorMessage } from "../stripe";
import { KEEP_SPLIT_INCLUDES_REVEAL, PARTNERS, estimateFee, splitNet } from "./split";

export * from "./split";

/** Make sure the three partner rows exist. */
export async function ensurePartners() {
  for (const p of PARTNERS) await db.partner.upsert({ where: { id: p.id }, update: {}, create: { id: p.id, name: p.name } });
}

/** The real Stripe fee on a succeeded PaymentIntent, or null if Stripe won't say. */
async function feeFor(paymentIntentId: string): Promise<number | null> {
  const s = stripe();
  if (!s) return null;
  try {
    const pi = await s.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const ch = pi.latest_charge;
    const bt = ch && typeof ch !== "string" ? ch.balance_transaction : null;
    return bt && typeof bt !== "string" ? bt.fee / 100 : null;
  } catch (e) {
    console.error("fee lookup failed", stripeErrorMessage(e));
    return null;
  }
}

/**
 * Record what each partner is owed for one sold pack. Runs after a keep or a blind buy (and as a catch-up on the
 * Partners page). Idempotent: a pack already split is left alone. Nothing here moves money.
 */
export async function recordSale(packId: string) {
  if (await db.partnerEarning.findFirst({ where: { packId } })) return { ok: true as const, already: true };
  const pack = await db.gamePack.findUnique({ where: { id: packId }, include: { cards: { select: { id: true, partnerId: true, listPrice: true } } } });
  if (!pack || (pack.status !== "kept" && pack.status !== "sold-blind")) return { ok: false as const, error: "not a sold pack" };
  const cycle = await db.gameCycle.findFirst({ where: { packId, status: { in: ["kept", "blind-bought"] } }, include: { charges: { where: { status: "succeeded" } } } });
  if (!cycle) return { ok: false as const, error: "no completed purchase for this pack" };
  const kinds = pack.status === "kept" ? (KEEP_SPLIT_INCLUDES_REVEAL ? ["reveal", "keep"] : ["keep"]) : ["blind"];
  const charges = cycle.charges.filter((c) => kinds.includes(c.kind));
  const packPrice = pack.status === "kept" ? (KEEP_SPLIT_INCLUDES_REVEAL ? PRICES.keepTotal : PRICES.keepMore) : PRICES.blind;
  let fee = 0;
  let estimated = false;
  for (const c of charges) {
    const f = c.paymentIntentId ? await feeFor(c.paymentIntentId) : null;
    if (f == null) estimated = true;
    fee += f ?? estimateFee(c.amount);
  }
  if (!charges.length) {
    estimated = true;
    fee = estimateFee(packPrice);
  }
  fee = Math.round(fee * 100) / 100;
  const net = Math.round((packPrice - fee) * 100) / 100;
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const holdings = pack.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({ partnerId: c.partnerId, value: c.listPrice ?? 0 }));
  const packValue = Math.round(holdings.reduce((a, h) => a + h.value, 0) * 100) / 100;
  const shares = splitNet(net, holdings);
  await db.partnerEarning.createMany({
    data: shares.map((s) => ({ partnerId: s.partnerId, packId, saleKind: pack.status, packPrice, stripeFee: fee, feeEstimated: estimated, net, cardValue: s.value, packValue, amount: s.amount })),
    skipDuplicates: true,
  });
  return { ok: true as const, already: false, net, shares };
}

/** Catch up any sold pack whose split didn't get written (Stripe slow, a crash between the sale and the split). */
export async function recordMissingSales() {
  const packs = await db.gamePack.findMany({ where: { status: { in: ["kept", "sold-blind"] }, NOT: { partnerIds: { isEmpty: true } } }, select: { id: true } });
  const done = new Set((await db.partnerEarning.findMany({ where: { packId: { in: packs.map((p) => p.id) } }, select: { packId: true } })).map((e) => e.packId));
  let n = 0;
  for (const p of packs) if (!done.has(p.id) && (await recordSale(p.id)).ok) n++;
  return n;
}

const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((a, b) => a + (b ?? 0), 0) * 100) / 100;

/** Per partner: cards uploaded, engine value in ready stacks, engine value sold, earned, paid, owed. */
export async function partnerSummary() {
  await ensurePartners();
  const partners = await db.partner.findMany({ orderBy: { createdAt: "asc" } });
  const out = [];
  for (const p of partners) {
    const [uploaded, inStock, ready, earnings, payouts] = await Promise.all([
      db.card.count({ where: { partnerId: p.id, status: { not: "Archived" } } }),
      db.card.aggregate({ where: { partnerId: p.id, status: { in: ["Priced", "BulkHold"] } }, _sum: { listPrice: true }, _count: true }),
      db.card.aggregate({ where: { partnerId: p.id, status: "LilStack", gamePack: { status: "available" } }, _sum: { listPrice: true }, _count: true }),
      db.partnerEarning.findMany({ where: { partnerId: p.id }, select: { amount: true, cardValue: true, payoutId: true, payout: { select: { status: true } } } }),
      db.partnerPayout.findMany({ where: { partnerId: p.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);
    out.push({
      id: p.id,
      name: p.name,
      stripeAccountId: p.stripeAccountId,
      uploaded,
      looseCards: inStock._count,
      looseValue: sum([inStock._sum.listPrice]),
      readyCards: ready._count,
      readyValue: sum([ready._sum.listPrice]),
      packsSold: earnings.length,
      soldValue: sum(earnings.map((e) => e.cardValue)),
      earned: sum(earnings.map((e) => e.amount)),
      paid: sum(earnings.filter((e) => e.payout?.status === "paid").map((e) => e.amount)),
      owed: sum(earnings.filter((e) => !e.payoutId).map((e) => e.amount)),
      payouts,
    });
  }
  return out;
}

/** Connected account status, for the Partners page. */
export async function accountStatus(accountId: string) {
  const s = stripe();
  if (!s) return null;
  try {
    const a = await s.accounts.retrieve(accountId);
    return { payoutsEnabled: !!a.payouts_enabled, transfers: a.capabilities?.transfers ?? "inactive", detailsSubmitted: !!a.details_submitted };
  } catch (e) {
    return { error: stripeErrorMessage(e) };
  }
}

/** Create the partner's Express connected account (once) and an onboarding link to send them. */
export async function onboardingLink(partnerId: string, origin: string) {
  const s = stripe();
  if (!s) throw new Error("STRIPE_SECRET_KEY is not set");
  const p = await db.partner.findUniqueOrThrow({ where: { id: partnerId } });
  let account = p.stripeAccountId;
  if (!account) {
    const a = await s.accounts.create({ type: "express", country: "US", capabilities: { transfers: { requested: true } }, metadata: { trade_shark_partner: p.id } });
    account = a.id;
    await db.partner.update({ where: { id: p.id }, data: { stripeAccountId: account } });
  }
  const base = siteUrl() || origin;
  const link = await s.accountLinks.create({ account, type: "account_onboarding", refresh_url: `${base}/admin/partners`, return_url: `${base}/admin/partners` });
  return link.url;
}

/**
 * Pay a partner their owed balance: one manual Stripe transfer to their connected account. The earnings it covers
 * are tied to the payout first, so two clicks can't pay the same pack twice; a failed transfer puts them back.
 */
export async function payPartner(partnerId: string) {
  const s = stripe();
  if (!s) return { ok: false as const, error: "STRIPE_SECRET_KEY is not set" };
  const p = await db.partner.findUniqueOrThrow({ where: { id: partnerId } });
  if (!p.stripeAccountId) return { ok: false as const, error: `${p.name} has no connected account yet.` };
  const owed = await db.partnerEarning.findMany({ where: { partnerId, payoutId: null }, select: { id: true, amount: true } });
  const amount = sum(owed.map((e) => e.amount));
  if (amount < 0.01) return { ok: false as const, error: `Nothing owed to ${p.name}.` };
  const payout = await db.partnerPayout.create({ data: { partnerId, amount, status: "pending" } });
  const claimed = await db.partnerEarning.updateMany({ where: { id: { in: owed.map((e) => e.id) }, payoutId: null }, data: { payoutId: payout.id } });
  if (claimed.count !== owed.length) {
    await db.partnerEarning.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "failed", error: "Another payout ran at the same time. Try again." } });
    return { ok: false as const, error: "Another payout ran at the same time. Try again." };
  }
  try {
    const t = await s.transfers.create(
      { amount: Math.round(amount * 100), currency: "usd", destination: p.stripeAccountId, description: `Trade Shark payout · ${p.name}`, metadata: { trade_shark_payout: payout.id, partner: p.id } },
      { idempotencyKey: `ts-payout-${payout.id}` },
    );
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "paid", transferId: t.id } });
    return { ok: true as const, amount, transferId: t.id };
  } catch (e) {
    const error = stripeErrorMessage(e).slice(0, 500);
    await db.partnerEarning.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "failed", error } });
    return { ok: false as const, error };
  }
}
