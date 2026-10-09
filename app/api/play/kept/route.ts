import { NextResponse } from "next/server";
import { PUBLIC_CATEGORIES } from "@/lib/categories";
import { siteUrl } from "@/lib/env";
import { currentBuyer, PLAYER_COOKIE, PLAYER_COOKIE_OPTS, playerToken } from "@/lib/game/buyer";
import { closeCheckout, completeCheckout } from "@/lib/game/play";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Stripe Checkout comes back here after a Keep without a saved card. Paid (`session_id`): the pack goes into their
 * Collection and the card is saved. Cancelled (`cycle`): the look resumes for what's left of its 120 s.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = siteUrl() || url.origin;
  const to = (path: string) => NextResponse.redirect(`${base}${path}`, 303);
  const sessionId = url.searchParams.get("session_id");
  if (sessionId) {
    const r = await completeCheckout(sessionId).catch((e) => (console.error("keep checkout return failed", e), null));
    if (!r?.ok) return to(`/packs/${PUBLIC_CATEGORIES[0]}?error=${encodeURIComponent(r?.error ?? "Something went wrong. Nothing was charged for a step that didn't finish.")}`);
    const res = to(`/collection?kept=${r.packId}`);
    res.cookies.set(PLAYER_COOKIE, playerToken(r.buyerId), PLAYER_COOKIE_OPTS);
    return res;
  }
  const buyer = await currentBuyer();
  const cycle = buyer ? await db.gameCycle.findFirst({ where: { id: url.searchParams.get("cycle") ?? "", buyerId: buyer.id } }) : null;
  if (!cycle) return to("/");
  await closeCheckout(cycle.id, "back").catch((e) => console.error("checkout cancel failed", e));
  return to(`/packs/${cycle.category}`);
}
