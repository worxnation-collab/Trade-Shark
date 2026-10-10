import type { Buyer } from "@prisma/client";
import type Stripe from "stripe";
import { isPublicCategory, productName, type Category } from "../categories";
import { db } from "../db";
import { splitSale } from "../lilStack";
import { stripe } from "../stripe";
import { isGuest } from "./buyer";
import { chargeApi, chargeSaved, refund, type ChargeApi } from "./charge";
import { isMember, perkLeft, refreshMember, usePerk } from "./member";
import { categoryStatus, packView, releasePack, reservePack } from "./packs";
import { recordSale } from "../partners";
import { CHECKOUT_HOLD_MS, KEEP_GRACE_MS, LOOKS_PER_DAY, LOOKS_PER_DAY_PER_IP, PRICES, TIMER_SECONDS, cryptoRng, isValidZone, keepCharge, keepPriceFor, storedKeepPrice, nextLocalMidnight, nextLookNumber, type Rng } from "./rules";

/**
 * One look per account at a time, and looking is free:
 *   Show me the cards → a reserved pack, all 12 on screen, 120 s → Keep (one charge) | Pass / timer.
 *   The keep price is the look's step on the ladder (KEEP_LADDER: look 1 $3.99, 2 $4.99, 3 $5.99 per category per
 *   local day), stored on the cycle when the pack is shown; Keep charges that stored price and nothing else.
 *   Pass or the timer puts the cards back and charges nothing. Leaving the page does not pass: the pack waits out
 *   its 120 s and the player can come back to it. Nothing locks; the only limit is LOOKS_PER_DAY per category per
 *   local day (account, card fingerprint, and a looser cap per network address), so nobody can fish the pool.
 *   Keep charges a saved card off-session; without one it goes to Stripe Checkout (the stored price, card saved with that
 *   payment), and the pack is held while Checkout is open.
 *   "Dealer's choice" ($6.99 blind pack, saved card only) is an optional quiet link: same pool, seen after paying.
 *   A bought pack goes into the player's Collection; shipping is its own step later (lib/game/ship.ts).
 *   Members get one bumped member stack and one mailer credit a month, and see new drops first.
 * Nothing is ever charged by the timer.
 */

export type PlayError = { ok: false; error: string; code?: string };
const err = (error: string, code?: string): PlayError => ({ ok: false, error, code });

/** Close any look whose 120 s (+ grace) ran out, and any Keep checkout that was never paid. Lazy: runs at the top of every play request. */
export async function sweepExpired(now = new Date(), api: CheckoutApi | null = checkoutApi()) {
  const stale = await db.gameCycle.findMany({ where: { status: "revealing", deadline: { lt: new Date(now.getTime() - KEEP_GRACE_MS) } }, select: { id: true } });
  for (const c of stale) await endWithoutPurchase(c.id, "expired", now);
  const checkouts = await db.gameCycle.findMany({ where: { status: "checkout", deadline: { lt: now } }, select: { id: true } });
  for (const c of checkouts) await closeCheckout(c.id, "expired", now, api).catch((e) => console.error("checkout sweep failed", e));
  // A request that died mid-charge shouldn't block the account forever.
  await db.gameCycle.updateMany({ where: { status: "charging", createdAt: { lt: new Date(now.getTime() - 120_000) } }, data: { status: "failed", endedAt: now } });
  return stale.length + checkouts.length;
}

/**
 * Looks left today in a category. Every look writes a row in GameLock (reused as the look ledger, nothing is
 * locked) that runs out at the player's next local midnight: one for the account and card, one for the network
 * address. The account and its card share LOOKS_PER_DAY; an address gets LOOKS_PER_DAY_PER_IP.
 */
export async function looksLeft(buyer: Pick<Buyer, "id" | "cardFingerprint"> | null, category: string, ip: string | null, now = new Date()) {
  const { used, net } = await looksUsed(buyer, category, ip, now);
  if (net >= LOOKS_PER_DAY_PER_IP) return 0;
  return Math.max(0, LOOKS_PER_DAY - used);
}

/** Looks this account (or its card) took today in a category, and the network address's count. `used` sets the keep price. */
async function looksUsed(buyer: Pick<Buyer, "id" | "cardFingerprint"> | null, category: string, ip: string | null, now: Date) {
  const live = { category, until: { gt: now } };
  const notIp = { OR: [{ fingerprint: null }, { NOT: { fingerprint: { startsWith: "ip:" } } }] };
  const [mine, card, net] = await Promise.all([
    buyer ? db.gameLock.count({ where: { ...live, buyerId: buyer.id, ...notIp } }) : 0,
    buyer?.cardFingerprint ? db.gameLock.count({ where: { ...live, fingerprint: buyer.cardFingerprint } }) : 0,
    ip ? db.gameLock.count({ where: { ...live, fingerprint: ip } }) : 0,
  ]);
  return { used: Math.max(mine, card), net };
}

/** What the play screen needs for one category. A signed-out visitor can look too. */
export async function playState(buyerIn: Buyer | null, category: Category, ip: string | null = null) {
  await sweepExpired();
  const buyer = buyerIn ? await refreshMember(buyerIn) : null;
  const member = isMember(buyer);
  const status = await categoryStatus(category, member);
  const { used, net } = await looksUsed(buyer, category, ip, new Date());
  const left = net >= LOOKS_PER_DAY_PER_IP ? 0 : Math.max(0, LOOKS_PER_DAY - used);
  // The look they'd take next and its keep price, for the button. Display only: the server stores the real one on look.
  const nextLook = nextLookNumber(used);
  const ladder = { nextLook, nextKeep: keepPriceFor(nextLook) };
  if (!buyer) return { ...status, ...ladder, signedIn: false as const, hasCard: false, cardLabel: null, member: false, stackLeft: false, looksLeft: left, revealing: null };
  // Back on the shop with a Keep checkout still open (browser Back, not Checkout's cancel link): same as cancelling it.
  const pending = await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: "checkout" } });
  if (pending) await closeCheckout(pending.id, "back").catch((e) => console.error("checkout close failed", e));
  const [revealing, stackLeft] = await Promise.all([db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: "revealing" } }), perkLeft(buyer, "stack")]);
  return {
    ...status,
    ...ladder,
    signedIn: true as const,
    hasCard: !!buyer.paymentMethodId,
    cardLabel: buyer.cardLabel,
    member,
    stackLeft,
    looksLeft: left,
    serverNow: new Date(),
    revealing: revealing
      ? {
          cycleId: revealing.id,
          category: revealing.category,
          deadline: revealing.deadline!,
          lookNumber: revealing.lookNumber ?? 1,
          keepPrice: storedKeepPrice(revealing.keepPrice),
          pack: revealing.category === category && revealing.packId ? await packView(revealing.packId) : null,
        }
      : null,
  };
}

/** Show me the cards: reserve a pack and start the 120 s clock. Free. */
export async function look(buyerIn: Buyer, category: string, opts: { rng?: Rng; now?: Date; memberStack?: boolean; ip?: string | null; tz?: string | null } = {}) {
  if (!isPublicCategory(category)) return err("That pack isn't open.", "closed");
  const now = opts.now ?? new Date();
  await sweepExpired(now);
  const buyer = await refreshMember(buyerIn);
  const member = isMember(buyer, now);
  const open = await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: { in: ["revealing", "charging", "keeping", "checkout"] } } });
  if (open) return err("Finish the pack you have open first.", "busy");
  const today = await looksUsed(buyer, category, opts.ip ?? null, now);
  if (today.net >= LOOKS_PER_DAY_PER_IP || today.used >= LOOKS_PER_DAY) return err(`That's ${LOOKS_PER_DAY} rolls of ${productName(category)}s today. More tomorrow.`, "no-looks");
  if (!(await categoryStatus(category, member, now)).open) return err(`No ${productName(category)}s are ready right now.`, "closed");
  const memberStack = !!opts.memberStack && member && (await perkLeft(buyer, "stack"));
  if (opts.memberStack && !memberStack) return err("Your member stack for this month is used (or your membership isn't active).", "no-stack");

  const got = await reservePack(category, buyer.id, { rng: opts.rng ?? cryptoRng, member, memberStack, now });
  if (!got) return err(`The last ${productName(category)} just went.`, "closed");
  // The member stack is used once it's shown with its bumped card (no $2–$4 card in stock = not used).
  if (memberStack && got.bumped) await usePerk(buyer, "stack");
  const deadline = new Date(now.getTime() + TIMER_SECONDS * 1000);
  // The keep price is fixed now, on the cycle, from which look of the day this is. Keep charges this and no other.
  const lookNumber = nextLookNumber(today.used);
  const keepPrice = keepPriceFor(lookNumber);
  const cycle = await db.gameCycle.create({
    data: { buyerId: buyer.id, category, kind: "peek", status: "revealing", packId: got.pack.id, revealedAt: now, deadline, member: memberStack && got.bumped, lookNumber, keepPrice },
  });
  // The look ledger (see looksLeft): ends at the player's local midnight.
  const until = nextLocalMidnight(now, isValidZone(opts.tz) ? opts.tz : buyer.tz);
  await db.gameLock.createMany({
    data: [
      { buyerId: buyer.id, fingerprint: buyer.cardFingerprint, category, until },
      ...(opts.ip ? [{ buyerId: buyer.id, fingerprint: opts.ip, category, until }] : []),
    ],
  });
  return { ok: true as const, cycleId: cycle.id, deadline, serverNow: new Date(), lookNumber, keepPrice, pack: await packView(got.pack.id) };
}

/** The bits of Stripe Checkout a Keep without a saved card uses, so tests can pass a fake. */
export interface CheckoutApi {
  customers: { create(p: Stripe.CustomerCreateParams): Promise<{ id: string }>; update(id: string, p: Stripe.CustomerUpdateParams): Promise<unknown> };
  checkout: {
    sessions: {
      create(p: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>;
      retrieve(id: string, p?: Stripe.Checkout.SessionRetrieveParams): Promise<Stripe.Checkout.Session>;
      expire(id: string): Promise<unknown>;
    };
  };
}
const checkoutApi = () => stripe() as unknown as CheckoutApi | null;

/**
 * Keep: one charge of the price stored on the cycle when it was shown; the pack goes into their Collection. A saved card is charged off-session. Without one the
 * player goes to Stripe Checkout, which saves the card with that payment; the pack is held until Checkout closes.
 */
export async function keep(
  buyer: Buyer,
  cycleId: string,
  opts: { api?: ChargeApi | null; checkout?: CheckoutApi | null; now?: Date; base?: string; amount?: unknown } = {},
): Promise<PlayError | { ok: true; pack: Awaited<ReturnType<typeof packView>>; checkoutUrl?: undefined } | { ok: true; checkoutUrl: string; pack?: undefined }> {
  const now = opts.now ?? new Date();
  const cycle = await db.gameCycle.findFirst({ where: { id: cycleId, buyerId: buyer.id } });
  if (!cycle || !cycle.packId) return err("That pack isn't yours.");
  if (cycle.status !== "revealing") return err("This pack is closed.", "closed");
  const price = keepCharge(cycle.keepPrice, opts.amount);
  if (!price.ok) return err(price.error, "price");
  const amount = price.amount;
  if (now.getTime() > cycle.deadline!.getTime() + KEEP_GRACE_MS) {
    await endWithoutPurchase(cycle.id, "expired", now);
    return err("Time ran out on that pack.", "expired");
  }
  // One Keep at a time (double taps).
  const claimed = await db.gameCycle.updateMany({ where: { id: cycle.id, status: "revealing" }, data: { status: "keeping" } });
  if (!claimed.count) return err("This pack is closed.", "closed");
  const label = `Pokéroll · ${productName(cycle.category)} kept`;

  if (!buyer.paymentMethodId) {
    const s = opts.checkout !== undefined ? opts.checkout : checkoutApi();
    const back = async (e: string) => {
      await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "revealing" } });
      return err(e, "declined");
    };
    if (!s || !opts.base) return back("Payments aren't set up yet.");
    try {
      let customer = buyer.stripeCustomerId;
      if (isGuest(buyer)) {
        customer = (await s.customers.create({ metadata: { trade_shark: "player", buyer_id: buyer.id } })).id;
        await db.buyer.update({ where: { id: buyer.id }, data: { stripeCustomerId: customer } });
      }
      const meta = { trade_shark: "game", kind: "keep", cycle_id: cycle.id, buyer_id: buyer.id };
      const expires = Math.floor((now.getTime() + CHECKOUT_HOLD_MS) / 1000) + 60;
      const session = await s.checkout.sessions.create({
        mode: "payment",
        customer,
        customer_update: { name: "auto", shipping: "auto" },
        shipping_address_collection: { allowed_countries: ["US"] },
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(amount * 100), product_data: { name: `${productName(cycle.category)} · all 12 cards` } } }],
        payment_intent_data: { setup_future_usage: "off_session", description: label, metadata: meta },
        metadata: meta,
        expires_at: expires,
        success_url: `${opts.base}/api/play/kept?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${opts.base}/api/play/kept?cycle=${cycle.id}`,
      });
      await db.gameCharge.create({ data: { buyerId: buyer.id, cycleId: cycle.id, ref: session.id, kind: "keep", amount, status: "pending" } });
      // Held while Checkout is open (it closes itself at expires_at); the sweep settles it after that.
      await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "checkout", deadline: new Date(expires * 1000 + 60_000) } });
      return { ok: true as const, checkoutUrl: session.url! };
    } catch (e) {
      console.error("keep checkout failed", e);
      return back("Couldn't open checkout. Try again.");
    }
  }

  const paid = await chargeSaved(buyer, amount, "keep", cycle.id, label, opts.api !== undefined ? opts.api : chargeApi());
  if (!paid.ok) {
    await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "revealing" } }); // the clock keeps running
    return err(paid.error, "declined");
  }
  await sellPack(cycle.packId, buyer, amount, "kept", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "kept", endedAt: now } });
  await splitForPartners(cycle.packId);
  return { ok: true as const, pack: await packView(cycle.packId) };
}

type ShipTo = { name?: string | null; address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null } | null };

/**
 * A Keep paid on Stripe Checkout (the return URL and the webhook both land here; idempotent). Saves the card, the
 * email and the address on the player, then sells the pack. Paid after the pack was already let go = refunded.
 */
export async function completeCheckout(sessionId: string, opts: { api?: ChargeApi | null; checkout?: CheckoutApi | null; now?: Date } = {}) {
  const s = opts.checkout !== undefined ? opts.checkout : checkoutApi();
  if (!s) return err("Payments aren't set up yet.");
  const now = opts.now ?? new Date();
  const session = await s.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.payment_method"] });
  const cycleId = session.metadata?.cycle_id;
  if (session.metadata?.kind !== "keep" || !cycleId) return err("Not a Keep checkout.");
  const cycle = await db.gameCycle.findUnique({ where: { id: cycleId }, include: { buyer: true } });
  if (!cycle || !cycle.packId) return err("That pack isn't here.");
  if (cycle.status === "kept") return { ok: true as const, already: true, packId: cycle.packId, buyerId: cycle.buyerId };
  if (session.payment_status !== "paid") return err("That payment didn't go through.", "unpaid");
  const pi = session.payment_intent as Stripe.PaymentIntent | null;
  // What Checkout actually took (it was opened for the cycle's stored price).
  const amount = session.amount_total != null ? session.amount_total / 100 : storedKeepPrice(cycle.keepPrice);
  const claimed = await db.gameCycle.updateMany({ where: { id: cycle.id, status: { in: ["checkout", "revealing"] } }, data: { status: "keeping" } });
  if (!claimed.count) {
    // The pack was let go before this payment landed: give the money back.
    if (pi?.id && !(await db.gameCharge.findFirst({ where: { cycleId: cycle.id, kind: "refund" } })))
      await refund(cycle.buyerId, cycle.id, pi.id, amount, opts.api !== undefined ? opts.api : chargeApi());
    return err(`That pack had already gone back. Your $${amount.toFixed(2)} was refunded.`, "closed");
  }
  const pm = pi?.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;
  const x = session as unknown as { collected_information?: { shipping_details?: ShipTo | null } | null; shipping_details?: ShipTo | null };
  const ship = x.collected_information?.shipping_details ?? x.shipping_details ?? null;
  const email = session.customer_details?.email ?? cycle.buyer.email;
  const name = ship?.name ?? session.customer_details?.name ?? cycle.buyer.name;
  const a = ship?.address;
  const brand = pm?.card ? pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1) : null;
  const buyer = await db.buyer.update({
    where: { id: cycle.buyerId },
    data: {
      email: email || "",
      name: name || "",
      ...(a?.line1
        ? { shipTo: JSON.stringify({ name, email, address: { name, line1: a.line1, line2: a.line2 ?? "", city: a.city ?? "", state: a.state ?? "", postal: a.postal_code ?? "", country: "US" } }), addressVerified: false }
        : {}),
      ...(pm?.card ? { paymentMethodId: pm.id, cardFingerprint: pm.card.fingerprint ?? null, cardLabel: `${brand} ·· ${pm.card.last4}` } : {}),
    },
  });
  if (pm && typeof session.customer === "string")
    await s.customers.update(session.customer, { invoice_settings: { default_payment_method: pm.id } }).catch((e) => console.error("default card not set", e));
  await db.gameCharge.updateMany({ where: { ref: session.id, kind: "keep", status: "pending" }, data: { status: "succeeded", paymentIntentId: pi?.id ?? null } });
  await sellPack(cycle.packId, buyer, amount, "kept", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "kept", endedAt: now } });
  await splitForPartners(cycle.packId);
  return { ok: true as const, already: false, packId: cycle.packId, buyerId: cycle.buyerId };
}

/**
 * Checkout closed without paying (cancel, or its hold ran out). Expire the session first so it can't be paid after
 * the pack goes back; if it turns out it was paid, finish the Keep instead.
 * `back` = the player came back from Checkout's cancel link: the look resumes for whatever is left of its 120 s.
 */
export async function closeCheckout(cycleId: string, status: "passed" | "expired" | "back", now = new Date(), api: CheckoutApi | null = checkoutApi()) {
  const cycle = await db.gameCycle.findUnique({ where: { id: cycleId } });
  if (!cycle || cycle.status !== "checkout") return { ok: true as const, status: cycle?.status ?? "missing" };
  const charge = await db.gameCharge.findFirst({ where: { cycleId, kind: "keep", status: "pending" }, orderBy: { createdAt: "desc" } });
  if (charge?.ref && api) {
    const session = await api.checkout.sessions.retrieve(charge.ref);
    if (session.status === "open") await api.checkout.sessions.expire(charge.ref).catch(() => null);
    const again = session.status === "open" ? await api.checkout.sessions.retrieve(charge.ref) : session;
    if (again.payment_status === "paid") {
      const done = await completeCheckout(charge.ref, { checkout: api, now });
      return { ok: true as const, status: done.ok ? "kept" : "closed" };
    }
  }
  if (charge) await db.gameCharge.update({ where: { id: charge.id }, data: { status: "failed", error: "checkout closed unpaid" } });
  if (status === "back" && cycle.revealedAt && now.getTime() < cycle.revealedAt.getTime() + TIMER_SECONDS * 1000) {
    await db.gameCycle.updateMany({ where: { id: cycleId, status: "checkout" }, data: { status: "revealing", deadline: new Date(cycle.revealedAt.getTime() + TIMER_SECONDS * 1000) } });
    return { ok: true as const, status: "revealing" };
  }
  await db.gameCycle.updateMany({ where: { id: cycleId, status: "checkout" }, data: { status: "revealing" } });
  await endWithoutPurchase(cycleId, status === "back" ? "expired" : status, now);
  return { ok: true as const, status: status === "back" ? "expired" : status };
}

/** Pass, or the timer. Never charges. Leaving the page is not a pass. */
export async function pass(buyer: Buyer, cycleId: string, now = new Date()) {
  const cycle = await db.gameCycle.findFirst({ where: { id: cycleId, buyerId: buyer.id } });
  if (!cycle) return err("That pack isn't yours.");
  if (cycle.status === "checkout") {
    await closeCheckout(cycle.id, "passed", now);
    return { ok: true as const, already: false };
  }
  if (cycle.status !== "revealing") return { ok: true as const, already: true };
  await endWithoutPurchase(cycle.id, "passed", now);
  return { ok: true as const, already: false };
}

/** The cards go back to stock (the desk lists them under "Put back"); nothing is charged and nothing locks. */
async function endWithoutPurchase(cycleId: string, status: "passed" | "expired", now: Date) {
  const done = await db.gameCycle.updateMany({ where: { id: cycleId, status: "revealing" }, data: { status, endedAt: now } });
  if (!done.count) return;
  const cycle = await db.gameCycle.findUniqueOrThrow({ where: { id: cycleId } });
  if (cycle.packId) await releasePack(cycle.packId, "expired", ["reserved"]);
}

/** Dealer's choice: the $6.99 blind pack. Saved card only. Charge first, then reserve from the same queue, then show. No reject. */
export async function blind(buyerIn: Buyer, category: string, opts: { api?: ChargeApi | null; rng?: Rng; now?: Date } = {}) {
  if (!isPublicCategory(category)) return err("That pack isn't open.", "closed");
  if (!buyerIn.paymentMethodId) return err("Keep a pack first; your card is saved with that payment.", "no-card");
  const now = opts.now ?? new Date();
  await sweepExpired(now);
  const buyer = await refreshMember(buyerIn);
  const member = isMember(buyer, now);
  if (await db.gameCycle.findFirst({ where: { buyerId: buyer.id, status: { in: ["revealing", "charging", "keeping", "checkout"] } } })) return err("Finish the pack you have open first.", "busy");
  if (!(await categoryStatus(category, member, now)).open) return err(`No ${productName(category)}s are ready right now.`, "closed");

  const cycle = await db.gameCycle.create({ data: { buyerId: buyer.id, category, kind: "blind", status: "charging" } });
  const api = opts.api !== undefined ? opts.api : chargeApi();
  const total = PRICES.blind;
  const paid = await chargeSaved(buyer, total, "blind", cycle.id, `Pokéroll · ${productName(category)} dealer's choice`, api);
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
  await sellPack(got.pack.id, buyer, total, "sold-blind", now);
  await db.gameCycle.update({ where: { id: cycle.id }, data: { status: "blind-bought", packId: got.pack.id, revealedAt: now, endedAt: now } });
  await splitForPartners(got.pack.id);
  return { ok: true as const, pack: await packView(got.pack.id) };
}

/** What each partner is owed for a completed keep or blind buy. Never blocks the sale; the Partners page catches up a miss. */
async function splitForPartners(packId: string) {
  await recordSale(packId).catch((e) => console.error("partner split failed", e));
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
