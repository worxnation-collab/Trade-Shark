import type { Buyer } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "../db";
import { stripe } from "../stripe";

/**
 * Membership: $7.99 a month (Stripe subscription). It does NOT add looks, cheaper packs or free shipping on every
 * pack. It gives: one mailer credit a month (zeros one label), one member stack a month (top slot bumped to a $2–$4
 * card), and the first hour of every new drop.
 */
export const MEMBER_PRICE = 7.99;
export const MEMBER_LOOKUP_KEY = "trade_shark_member_monthly";
export const MEMBER_PERKS = [
  "One mailer credit a month: one parcel ships free",
  "One member stack a month: the best card is bumped to $2–$4",
  "New drops an hour before everyone else",
];
export type Perk = "mailer" | "stack";

/** The $7.99/month price, made once in Stripe and found again by its lookup key. */
export async function memberPrice(s: Stripe) {
  const found = await s.prices.list({ lookup_keys: [MEMBER_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const product = await s.products.create({ name: "Pokéroll Membership", description: MEMBER_PERKS.join(". ") + "." });
  const price = await s.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: Math.round(MEMBER_PRICE * 100),
    recurring: { interval: "month" },
    lookup_key: MEMBER_LOOKUP_KEY,
  });
  return price.id;
}

/** Copy a subscription's state onto the buyer. Period dates live on the item in newer Stripe API versions. */
export async function applySubscription(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number }) | undefined;
  const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const start = item?.current_period_start ?? legacy.current_period_start;
  const end = item?.current_period_end ?? legacy.current_period_end;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return db.buyer.updateMany({
    where: { OR: [{ memberSubscriptionId: sub.id }, { stripeCustomerId: customer }] },
    data: {
      memberSubscriptionId: sub.id,
      memberStatus: sub.status,
      memberPeriodStart: start ? new Date(start * 1000) : null,
      memberUntil: end ? new Date(end * 1000) : null,
      memberCancelAtEnd: !!sub.cancel_at_period_end,
      memberCheckedAt: new Date(),
    },
  });
}

/** Re-read the subscription from Stripe at most hourly (or when the period has run out), so no webhook is required. */
export async function refreshMember(buyer: Buyer, force = false): Promise<Buyer> {
  if (!buyer.memberSubscriptionId) return buyer;
  const stale = !buyer.memberCheckedAt || Date.now() - buyer.memberCheckedAt.getTime() > 3600_000 || (buyer.memberUntil && buyer.memberUntil < new Date());
  if (!force && !stale) return buyer;
  const s = stripe();
  if (!s) return buyer;
  try {
    await applySubscription(await s.subscriptions.retrieve(buyer.memberSubscriptionId));
    return db.buyer.findUniqueOrThrow({ where: { id: buyer.id } });
  } catch (e) {
    console.error("membership refresh failed", e);
    return buyer;
  }
}

export function isMember(b: Pick<Buyer, "memberStatus" | "memberUntil"> | null | undefined, now = new Date()) {
  return !!b && (b.memberStatus === "active" || b.memberStatus === "trialing") && !!b.memberUntil && b.memberUntil > now;
}

/** Perks reset each billing period. */
export const periodKey = (b: Pick<Buyer, "memberPeriodStart">) => (b.memberPeriodStart ?? new Date(0)).toISOString().slice(0, 10);

export async function perkLeft(b: Buyer, perk: Perk) {
  if (!isMember(b)) return false;
  return !(await db.memberPerk.findUnique({ where: { buyerId_kind_period: { buyerId: b.id, kind: perk, period: periodKey(b) } } }));
}

/** Use a perk once per period. False if it was already used (the unique row is the lock). */
export async function usePerk(b: Buyer, perk: Perk) {
  if (!isMember(b)) return false;
  try {
    await db.memberPerk.create({ data: { buyerId: b.id, kind: perk, period: periodKey(b) } });
    return true;
  } catch {
    return false;
  }
}
