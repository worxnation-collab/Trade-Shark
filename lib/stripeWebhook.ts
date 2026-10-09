import type Stripe from "stripe";
import { db } from "./db";
import { markPackSold, packForLink } from "./lilStack";

/**
 * checkout.session.completed for a Keep (metadata kind "keep") → finish that Keep (lib/game/play.ts completeCheckout).
 * checkout.session.completed → mark the matching card (or Lil' Stack and all its cards) Sold. Matching is by
 * the Payment Link id stored on the card or pack; sessions from anything else are ignored. Idempotent: a repeat delivery
 * for an already-sold card changes nothing.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; note: string }> {
  // Membership changes (renewals, cancels). The game also re-reads the subscription hourly, so this is a speed-up.
  // A paid membership invoice is company money: it goes into the consignment reserve.
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const inv = event.data.object as Stripe.Invoice & { subscription?: string | null; parent?: { subscription_details?: { subscription?: string } | null } | null };
    const sub = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
    // The only subscription the shop sells is the membership: match it to a player's membership.
    const member = sub ? await db.buyer.findFirst({ where: { memberSubscriptionId: sub }, select: { id: true } }) : null;
    if (member && inv.amount_paid > 0) {
      const { reserveMembership } = await import("./partners");
      await reserveMembership(inv.id!, inv.amount_paid / 100);
      return { handled: true, note: `membership ${inv.id} into the reserve` };
    }
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted" || event.type === "customer.subscription.created") {
    const { applySubscription } = await import("./game/member");
    const r = await applySubscription(event.data.object as Stripe.Subscription);
    return { handled: r.count > 0, note: `membership ${event.type} (${r.count})` };
  }
  // A Keep paid on Checkout (no saved card yet). The return URL usually gets there first; this catches a closed tab.
  if (event.type.startsWith("checkout.session.") && (event.data.object as Stripe.Checkout.Session).metadata?.kind === "keep") {
    const s = event.data.object as Stripe.Checkout.Session;
    const { closeCheckout, completeCheckout } = await import("./game/play");
    if (event.type === "checkout.session.expired") {
      const r = await closeCheckout(s.metadata!.cycle_id!, "expired");
      return { handled: true, note: `keep checkout ${s.id} ${r.status}` };
    }
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return { handled: false, note: `ignored ${event.type}` };
    const r = await completeCheckout(s.id);
    return { handled: r.ok, note: r.ok ? `keep ${s.id} kept` : `keep ${s.id}: ${r.error}` };
  }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded")
    return { handled: false, note: `ignored ${event.type}` };
  const session = event.data.object as Stripe.Checkout.Session;
  const linkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  if (!linkId) return { handled: false, note: "session has no payment link" };
  if (session.payment_status !== "paid") return { handled: false, note: `payment_status ${session.payment_status}` };
  const card =
    (await db.card.findFirst({ where: { paymentLinkId: linkId } })) ??
    // A buyer may finish checkout on a link that was regenerated after they opened it.
    (await db.card.findMany({ where: { paymentLinkHistory: { contains: linkId } } })).find((c) => c.paymentLinkHistory.split(",").includes(linkId));
  const total = (session.amount_total ?? 0) / 100;
  const shipTo = shippingAddress(session);
  if (!card) {
    // Not a single: maybe a whole Lil' Stack.
    const pack = await packForLink(linkId);
    if (!pack) return { handled: false, note: `no card or pack for ${linkId}` };
    const ship = orderShipping(total, pack, linkId);
    const r = await markPackSold(pack.id, {
      amount: ship.merch,
      at: new Date((session.created ?? Date.now() / 1000) * 1000),
      sessionId: session.id,
      channel: "stripe",
      shippingCharged: ship.charged,
      shipMethod: ship.method,
      shipTo,
    });
    return { handled: r.ok, note: r.note };
  }
  if (card.status === "Sold") return { handled: true, note: "already sold" };
  const ship = orderShipping(total, card, linkId);
  await db.card.update({
    where: { id: card.id },
    data: {
      status: "Sold",
      soldPrice: ship.merch,
      shippingCharged: ship.charged,
      shipMethod: ship.method,
      shipTo,
      soldChannel: "stripe",
      soldAt: new Date((session.created ?? Date.now() / 1000) * 1000),
      stripeSessionId: session.id,
      paymentLinkActive: false,
    },
  });
  return { handled: true, note: `sold ${card.id}` };
}

/**
 * Split the checkout total into merchandise and the shipping line that link carried.
 * A checkout on an older link uses the difference from the current merchandise price.
 */
function orderShipping(
  total: number,
  o: { paymentLinkId: string | null; paymentLinkAmount: number | null; paymentLinkShipping: number | null; paymentLinkShipMethod: string | null },
  linkId: string,
) {
  const current = o.paymentLinkId === linkId;
  const charged = current && o.paymentLinkShipping != null ? o.paymentLinkShipping : Math.max(0, Math.round((total - (o.paymentLinkAmount ?? total)) * 100) / 100);
  return { charged, merch: Math.round((total - charged) * 100) / 100, method: o.paymentLinkShipMethod };
}

/** Name + address Stripe collected, kept on the order so I can ship it. */
function shippingAddress(session: Stripe.Checkout.Session): string | null {
  const x = session as unknown as {
    shipping_details?: { name?: string | null; address?: Record<string, string | null> | null } | null;
    collected_information?: { shipping_details?: { name?: string | null; address?: Record<string, string | null> | null } | null } | null;
    customer_details?: { name?: string | null; email?: string | null } | null;
  };
  const d = x.collected_information?.shipping_details ?? x.shipping_details;
  if (!d?.address) return null;
  return JSON.stringify({ name: d.name ?? x.customer_details?.name ?? null, email: x.customer_details?.email ?? null, address: d.address });
}
