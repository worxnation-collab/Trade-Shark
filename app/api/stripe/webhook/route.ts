import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripeWebhook";

export const runtime = "nodejs";

/**
 * Stripe → the shop. Public route (no password), so every request must carry a valid
 * Stripe signature for STRIPE_WEBHOOK_SECRET. This is the only automatic way a card becomes Sold.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    // constructEvent only needs the webhook helper; a dummy key is fine if STRIPE_SECRET_KEY is unset.
    const client = stripe() ?? new Stripe("sk_unused");
    event = client.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `bad signature: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
  const r = await handleStripeEvent(event);
  return NextResponse.json({ received: true, ...r });
}
