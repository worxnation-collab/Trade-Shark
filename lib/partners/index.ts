import { db } from "../db";
import { siteUrl } from "../env";
import { PRICES, storedKeepPrice } from "../game/rules";
import { getSettings } from "../settings";
import { stripe, stripeErrorMessage } from "../stripe";
import { PARTNERS, STAMP_CREDIT, estimateFee, reserveState, splitNet } from "./split";

export * from "./split";

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: (number | null | undefined)[]) => r2(xs.reduce<number>((a, b) => a + (b ?? 0), 0));

/** Make sure the three founder rows exist. */
export async function ensurePartners() {
  for (const p of PARTNERS) await db.partner.upsert({ where: { id: p.id }, update: {}, create: { id: p.id, name: p.name } });
}

export async function consignOpen() {
  return !!(await getSettings()).consignOpen;
}

/* ------------------------------------------------------------------ reserve */

/** Company money in (never a sender's money). Idempotent by `ref`. */
export async function addReserve(kind: string, amount: number, ref: string, note?: string) {
  if (!(Math.abs(amount) >= 0.01)) return;
  await db.reserveEntry.create({ data: { kind, amount: r2(amount), ref, note } }).catch((e: { code?: string }) => {
    if (e.code !== "P2002") throw e; // already recorded
  });
}

/** A membership invoice was paid: company revenue, into the reserve. */
export async function reserveMembership(invoiceId: string, amountPaid: number) {
  await addReserve("membership", amountPaid - estimateFee(amountPaid), `member:${invoiceId}`, "membership (fee estimated)");
}

/** Where the reserve stands right now. */
export async function reserveNow() {
  const [bal, payable, committed, liability] = await Promise.all([
    db.reserveEntry.aggregate({ _sum: { amount: true } }),
    db.senderEarning.aggregate({ where: { OR: [{ payoutId: null }, { payout: { status: { not: "paid" } } }] }, _sum: { amount: true } }),
    db.card.aggregate({ where: { senderId: { not: null }, status: "LilStack", gamePack: { status: { in: ["available", "reserved"] } } }, _sum: { listPrice: true } }),
    db.card.aggregate({ where: { senderId: { not: null }, status: { notIn: ["Sold", "Archived"] } }, _sum: { listPrice: true } }),
  ]);
  return reserveState({ balance: sum([bal._sum.amount]), payable: sum([payable._sum.amount]), committed: sum([committed._sum.listPrice]), liability: sum([liability._sum.listPrice]) });
}

/** Consignment cards in stock that the reserve can't cover yet (the hold bin), biggest first. */
export async function holdBin() {
  const r = await reserveNow();
  const loose = await db.card.findMany({
    where: { senderId: { not: null }, status: { in: ["Priced", "BulkHold"] }, gamePackId: null },
    orderBy: { listPrice: "desc" },
    take: 200,
    select: { id: true, name: true, player: true, listPrice: true, senderId: true, category: true },
  });
  const senders = new Map((await db.sender.findMany({ where: { id: { in: [...new Set(loose.map((c) => c.senderId!))] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  return loose.map((c) => ({
    ...c,
    owedTo: senders.get(c.senderId!) ?? "?",
    onHand: r.onHand,
    shortfall: r2(Math.max(0, (c.listPrice ?? 0) - r.headroom)),
    held: (c.listPrice ?? 0) > r.headroom,
  }));
}

/* ------------------------------------------------------------------ a sale */

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
 * Settle one sold pack (keep or blind only). Founders: net (amount charged − Stripe fee − stamp credit) split by engine
 * value. Senders: each consignment card's engine price, moved from reserved to payable. Whatever the founders don't
 * get (consignment and untagged cards' share) is company money and goes into the reserve. Idempotent per pack.
 */
export async function recordSale(packId: string) {
  if (await db.reserveEntry.findUnique({ where: { ref: `pack:${packId}` } })) return { ok: true as const, already: true };
  if (await db.partnerEarning.findFirst({ where: { packId } })) return { ok: true as const, already: true };
  const pack = await db.gamePack.findUnique({ where: { id: packId }, include: { cards: { select: { id: true, partnerId: true, senderId: true, listPrice: true } } } });
  if (!pack || (pack.status !== "kept" && pack.status !== "sold-blind")) return { ok: false as const, error: "not a sold pack" };
  const cycle = await db.gameCycle.findFirst({ where: { packId, status: { in: ["kept", "blind-bought"] } }, include: { charges: { where: { status: "succeeded" } } } });
  if (!cycle) return { ok: false as const, error: "no completed purchase for this pack" };
  const kinds = pack.status === "kept" ? ["keep"] : ["blind"];
  const charges = cycle.charges.filter((c) => kinds.includes(c.kind));
  // The amount actually charged: the succeeded charges, else what the pack recorded, else the cycle's stored price.
  const packPrice = charges.length
    ? r2(charges.reduce((a, c) => a + c.amount, 0))
    : (pack.charged ?? (pack.status === "kept" ? storedKeepPrice(cycle.keepPrice) : PRICES.blind));
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
  fee = r2(fee);
  const credit = cycle.creditUsed ? STAMP_CREDIT : 0;
  const net = r2(Math.max(0, packPrice - fee - credit));
  const byId = new Map(pack.cards.map((c) => [c.id, c]));
  const cards = pack.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  // Consignment and untagged cards hold no founder share: that part of the net stays with the company.
  const shares = splitNet(net, cards.map((c) => ({ partnerId: c.senderId ? null : c.partnerId, value: c.listPrice ?? 0 })));
  const packValue = sum(cards.map((c) => c.listPrice));
  const companyPart = r2(net - sum(shares.map((s) => s.amount)));
  const consigned = cards.filter((c) => c.senderId);
  await db.$transaction([
    db.reserveEntry.create({ data: { kind: "pack", amount: companyPart, ref: `pack:${packId}`, note: `company part of pack ${pack.category} ${pack.number ?? ""}` } }),
    db.partnerEarning.createMany({
      data: shares.map((s) => ({ partnerId: s.partnerId, packId, saleKind: pack.status, packPrice, stripeFee: fee, feeEstimated: estimated, net, cardValue: s.value, packValue, amount: s.amount })),
      skipDuplicates: true,
    }),
    db.senderEarning.createMany({ data: consigned.map((c) => ({ senderId: c.senderId!, cardId: c.id, packId, amount: r2(c.listPrice ?? 0) })), skipDuplicates: true }),
  ]);
  return { ok: true as const, already: false, net, shares, companyPart, consigned: consigned.length };
}

/** Catch up any sold pack whose settlement didn't get written (Stripe slow, a crash between the sale and the split). */
export async function recordMissingSales() {
  const packs = await db.gamePack.findMany({
    where: { status: { in: ["kept", "sold-blind"] }, OR: [{ NOT: { partnerIds: { isEmpty: true } } }, { NOT: { senderIds: { isEmpty: true } } }] },
    select: { id: true },
  });
  const done = new Set(
    (await db.reserveEntry.findMany({ where: { ref: { in: packs.map((p) => `pack:${p.id}`) } }, select: { ref: true } })).map((e) => e.ref!.slice(5)),
  );
  for (const e of await db.partnerEarning.findMany({ where: { packId: { in: packs.map((p) => p.id) } }, select: { packId: true } })) done.add(e.packId);
  let n = 0;
  for (const p of packs) if (!done.has(p.id) && (await recordSale(p.id)).ok) n++;
  return n;
}

/* ------------------------------------------------------------------ dashboard */

async function stockFigures(where: { partnerId: string } | { senderId: string }) {
  const [uploaded, ready, loose] = await Promise.all([
    db.card.count({ where: { ...where, status: { not: "Archived" } } }),
    db.card.aggregate({ where: { ...where, status: "LilStack", gamePack: { status: "available" } }, _sum: { listPrice: true }, _count: true }),
    db.card.aggregate({ where: { ...where, status: { in: ["Priced", "BulkHold", "LilStack"] } }, _sum: { listPrice: true }, _count: true }),
  ]);
  return { uploaded, readyCards: ready._count, readyValue: sum([ready._sum.listPrice]), unsoldCards: loose._count, unsoldValue: sum([loose._sum.listPrice]) };
}

/** Per founder: cards uploaded, value in ready stacks, value sold, retained into the reserve, payable. */
export async function founderSummary() {
  await ensurePartners();
  const partners = await db.partner.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(
    partners.map(async (p) => {
      const [stock, earnings, payouts] = await Promise.all([
        stockFigures({ partnerId: p.id }),
        db.partnerEarning.findMany({ where: { partnerId: p.id }, select: { amount: true, cardValue: true, payoutId: true, payout: { select: { status: true } } } }),
        db.partnerPayout.findMany({ where: { partnerId: p.id }, orderBy: { createdAt: "desc" }, take: 10 }),
      ]);
      return {
        kind: "founder" as const,
        id: p.id,
        name: p.name,
        stripeAccountId: p.stripeAccountId,
        ...stock,
        packsSold: earnings.length,
        soldValue: sum(earnings.map((e) => e.cardValue)),
        earned: sum(earnings.map((e) => e.amount)),
        paid: sum(earnings.filter((e) => e.payout?.status === "paid").map((e) => e.amount)),
        reserved: sum(earnings.filter((e) => e.payout?.status === "retained").map((e) => e.amount)), // retained into the reserve
        payable: sum(earnings.filter((e) => !e.payoutId).map((e) => e.amount)),
        payouts,
      };
    }),
  );
}

/** Per sender: cards uploaded, value in ready stacks, value sold, reserved (unsold cards' engine price), payable. */
export async function senderSummary() {
  const senders = await db.sender.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(
    senders.map(async (s) => {
      const [stock, earnings, payouts] = await Promise.all([
        stockFigures({ senderId: s.id }),
        db.senderEarning.findMany({ where: { senderId: s.id }, select: { amount: true, payoutId: true, payout: { select: { status: true } } } }),
        db.senderPayout.findMany({ where: { senderId: s.id }, orderBy: { createdAt: "desc" }, take: 10 }),
      ]);
      return {
        kind: "sender" as const,
        id: s.id,
        name: s.name,
        email: s.email,
        stripeAccountId: s.stripeAccountId,
        ...stock,
        cardsSold: earnings.length,
        soldValue: sum(earnings.map((e) => e.amount)),
        paid: sum(earnings.filter((e) => e.payout?.status === "paid").map((e) => e.amount)),
        reserved: stock.unsoldValue,
        payable: sum(earnings.filter((e) => e.payout?.status !== "paid").map((e) => e.amount)),
        payouts,
      };
    }),
  );
}

/* ------------------------------------------------------------------ Stripe Connect */

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

/** Create the owner's Express connected account (once) and an onboarding link to send them. */
export async function onboardingLink(owner: { kind: "founder" | "sender"; id: string }, origin: string) {
  const s = stripe();
  if (!s) throw new Error("STRIPE_SECRET_KEY is not set");
  const row = owner.kind === "founder" ? await db.partner.findUniqueOrThrow({ where: { id: owner.id } }) : await db.sender.findUniqueOrThrow({ where: { id: owner.id } });
  let account = row.stripeAccountId;
  if (!account) {
    const a = await s.accounts.create({ type: "express", country: "US", capabilities: { transfers: { requested: true } }, metadata: { trade_shark_owner: `${owner.kind}:${row.id}` } });
    account = a.id;
    if (owner.kind === "founder") await db.partner.update({ where: { id: row.id }, data: { stripeAccountId: account } });
    else await db.sender.update({ where: { id: row.id }, data: { stripeAccountId: account } });
  }
  const base = siteUrl() || origin;
  return (await s.accountLinks.create({ account, type: "account_onboarding", refresh_url: `${base}/admin/partners`, return_url: `${base}/admin/partners` })).url;
}

async function transfer(amount: number, destination: string, description: string, ref: string) {
  const s = stripe();
  if (!s) throw new Error("STRIPE_SECRET_KEY is not set");
  return s.transfers.create({ amount: Math.round(amount * 100), currency: "usd", destination, description, metadata: { trade_shark_payout: ref } }, { idempotencyKey: `ts-payout-${ref}` });
}

/**
 * A founder's payable balance: paid out with one manual transfer, or (`retain`) kept in the business as reserve money.
 * The earnings it covers are tied to the payout first, so two clicks can't pay the same pack twice.
 */
export async function payPartner(partnerId: string, opts: { retain?: boolean } = {}) {
  const p = await db.partner.findUniqueOrThrow({ where: { id: partnerId } });
  if (!opts.retain && !p.stripeAccountId) return { ok: false as const, error: `${p.name} has no connected account yet.` };
  if (!opts.retain && !stripe()) return { ok: false as const, error: "STRIPE_SECRET_KEY is not set" };
  const owed = await db.partnerEarning.findMany({ where: { partnerId, payoutId: null }, select: { id: true, amount: true } });
  const amount = sum(owed.map((e) => e.amount));
  if (amount < 0.01) return { ok: false as const, error: `Nothing payable to ${p.name}.` };
  const payout = await db.partnerPayout.create({ data: { partnerId, amount, status: "pending" } });
  const claimed = await db.partnerEarning.updateMany({ where: { id: { in: owed.map((e) => e.id) }, payoutId: null }, data: { payoutId: payout.id } });
  if (claimed.count !== owed.length) {
    await db.partnerEarning.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "failed", error: "Another payout ran at the same time." } });
    return { ok: false as const, error: "Another payout ran at the same time. Try again." };
  }
  if (opts.retain) {
    await addReserve("retained", amount, `retain:${payout.id}`, `${p.name}'s share kept in the reserve`);
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "retained" } });
    return { ok: true as const, amount, retained: true };
  }
  try {
    const t = await transfer(amount, p.stripeAccountId!, `Trade Shark payout · ${p.name}`, payout.id);
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "paid", transferId: t.id } });
    return { ok: true as const, amount, transferId: t.id };
  } catch (e) {
    const error = stripeErrorMessage(e).slice(0, 500);
    await db.partnerEarning.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
    await db.partnerPayout.update({ where: { id: payout.id }, data: { status: "failed", error } });
    return { ok: false as const, error };
  }
}

/** A sender's payable balance, by one manual transfer, out of the reserve. Disabled while consignment is locked. */
export async function paySender(senderId: string) {
  if (!(await consignOpen())) return { ok: false as const, error: "Consignment is locked. Sender payouts are off." };
  const s = await db.sender.findUniqueOrThrow({ where: { id: senderId } });
  if (!s.stripeAccountId) return { ok: false as const, error: `${s.name} has no connected account yet.` };
  const owed = await db.senderEarning.findMany({ where: { senderId, OR: [{ payoutId: null }, { payout: { status: "failed" } }] }, select: { id: true, amount: true } });
  const amount = sum(owed.map((e) => e.amount));
  if (amount < 0.01) return { ok: false as const, error: `Nothing payable to ${s.name}.` };
  const payout = await db.senderPayout.create({ data: { senderId, amount, status: "pending" } });
  await db.senderEarning.updateMany({ where: { id: { in: owed.map((e) => e.id) } }, data: { payoutId: payout.id } });
  try {
    const t = await transfer(amount, s.stripeAccountId, `Trade Shark consignment payout · ${s.name}`, payout.id);
    await db.senderPayout.update({ where: { id: payout.id }, data: { status: "paid", transferId: t.id } });
    await addReserve("sender-payout", -amount, `payout:${payout.id}`, `paid ${s.name}`);
    return { ok: true as const, amount, transferId: t.id };
  } catch (e) {
    const error = stripeErrorMessage(e).slice(0, 500);
    await db.senderEarning.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
    await db.senderPayout.update({ where: { id: payout.id }, data: { status: "failed", error } });
    return { ok: false as const, error };
  }
}
