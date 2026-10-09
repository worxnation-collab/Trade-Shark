import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/env";
import { currentBuyer } from "@/lib/game/buyer";
import { isMember, memberPrice } from "@/lib/game/member";
import { stripe, stripeErrorMessage } from "@/lib/stripe";

export const runtime = "nodejs";

/** Start a $7.99/month membership with Stripe Checkout (subscription mode, the player's saved customer). */
export async function POST(req: Request) {
  const base = siteUrl() || new URL(req.url).origin;
  const back = (msg: string) => NextResponse.redirect(`${base}/play/member?error=${encodeURIComponent(msg)}`, 303);
  const s = stripe();
  const buyer = await currentBuyer();
  if (!buyer) return NextResponse.redirect(`${base}/play/card?next=`, 303);
  if (!s) return back("Payments aren't set up yet.");
  if (isMember(buyer)) return NextResponse.redirect(`${base}/play/member`, 303);
  try {
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: buyer.stripeCustomerId,
      line_items: [{ price: await memberPrice(s), quantity: 1 }],
      success_url: `${base}/api/play/member/joined?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/play/member`,
      metadata: { buyer_id: buyer.id, trade_shark: "membership" },
    });
    return NextResponse.redirect(session.url!, 303);
  } catch (e) {
    console.error("member join failed", e);
    return back(stripeErrorMessage(e));
  }
}
