import type Stripe from "stripe";
import { db } from "./db";
import { markPackSold, packForLink } from "./lilStack";

/**
 * checkout.session.completed → mark the matching card (or Lil' Stack and all its cards) Sold. Matching is by
 * the Payment Link id stored on the card or pack; sessions from anything else are ignored. Idempotent: a repeat delivery
 * for an already-sold card changes nothing.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; note: string }> {
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
  if (!card) {
    // Not a single: maybe a whole Lil' Stack.
    const pack = await packForLink(linkId);
    if (!pack) return { handled: false, note: `no card or pack for ${linkId}` };
    const r = await markPackSold(pack.id, {
      amount: (session.amount_total ?? 0) / 100,
      at: new Date((session.created ?? Date.now() / 1000) * 1000),
      sessionId: session.id,
      channel: "stripe",
    });
    return { handled: r.ok, note: r.note };
  }
  if (card.status === "Sold") return { handled: true, note: "already sold" };
  await db.card.update({
    where: { id: card.id },
    data: {
      status: "Sold",
      soldPrice: (session.amount_total ?? 0) / 100,
      soldChannel: "stripe",
      soldAt: new Date((session.created ?? Date.now() / 1000) * 1000),
      stripeSessionId: session.id,
      paymentLinkActive: false,
    },
  });
  return { handled: true, note: `sold ${card.id}` };
}
