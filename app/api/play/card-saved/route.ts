import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { isCategory } from "@/lib/categories";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/env";
import { currentBuyer } from "@/lib/game/buyer";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/** Stripe sends players back here after saving a card. Store it as their card for every charge after. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = siteUrl() || url.origin;
  const next = url.searchParams.get("next");
  const to = (path: string) => NextResponse.redirect(`${base}${path}`, 303);
  const s = stripe();
  const buyer = await currentBuyer();
  const id = url.searchParams.get("session_id");
  if (!s || !buyer || !id) return to("/play/card?error=" + encodeURIComponent("Couldn't save that card. Try again."));
  const session = await s.checkout.sessions.retrieve(id, { expand: ["setup_intent.payment_method"] });
  const si = session.setup_intent as Stripe.SetupIntent | null;
  const pm = si?.payment_method as Stripe.PaymentMethod | null;
  if (session.customer !== buyer.stripeCustomerId || si?.status !== "succeeded" || !pm?.card)
    return to("/play/card?error=" + encodeURIComponent("That card didn't save. Try again."));
  await s.customers.update(buyer.stripeCustomerId, { invoice_settings: { default_payment_method: pm.id } });
  const brand = pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1);
  await db.buyer.update({ where: { id: buyer.id }, data: { paymentMethodId: pm.id, cardFingerprint: pm.card.fingerprint ?? null, cardLabel: `${brand} ·· ${pm.card.last4}` } });
  return to(isCategory(next) ? `/packs/${next}` : "/");
}
