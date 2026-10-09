import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/env";
import { currentBuyer } from "@/lib/game/buyer";
import { applySubscription } from "@/lib/game/member";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/** Cancel at the end of the paid month (perks last until then). Posting again with resume=1 undoes it. */
export async function POST(req: Request) {
  const base = siteUrl() || new URL(req.url).origin;
  const s = stripe();
  const buyer = await currentBuyer();
  if (s && buyer?.memberSubscriptionId) {
    const resume = (await req.formData().catch(() => null))?.get("resume") === "1";
    await applySubscription(await s.subscriptions.update(buyer.memberSubscriptionId, { cancel_at_period_end: !resume }));
  }
  return NextResponse.redirect(`${base}/play/member`, 303);
}
