import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/env";
import { currentBuyer } from "@/lib/game/buyer";
import { applySubscription } from "@/lib/game/member";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/** Back from Stripe after joining: read the subscription so perks start right away. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = siteUrl() || url.origin;
  const s = stripe();
  const buyer = await currentBuyer();
  const id = url.searchParams.get("session_id");
  if (s && buyer && id) {
    const session = await s.checkout.sessions.retrieve(id, { expand: ["subscription"] });
    if (session.customer === buyer.stripeCustomerId && session.subscription && typeof session.subscription !== "string")
      await applySubscription(session.subscription as Stripe.Subscription);
  }
  return NextResponse.redirect(`${base}/play/member`, 303);
}
