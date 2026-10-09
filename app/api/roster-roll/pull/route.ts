import { NextResponse } from "next/server";
import { currentBuyer, newGuest, PLAYER_COOKIE, PLAYER_COOKIE_OPTS, playerToken } from "@/lib/game/buyer";
import { isValidZone } from "@/lib/game/rules";
import { pullSingle, WINNER_COOKIE, winnerCookie } from "@/lib/rosterRoll";

export const runtime = "nodejs";

/**
 * The winner's "Pull it.": one free single, once per date. The card goes into this browser's player vault (a guest
 * player is made if there isn't one) and nothing ships. On success this browser gets the signed winner cookie, so a
 * refresh still shows the card. Anything else answers { ok: false } and changes nothing.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { date?: unknown; handle?: unknown; tz?: unknown };
  try {
    const current = await currentBuyer();
    const buyer = current ?? (await newGuest(typeof body.tz === "string" && isValidZone(body.tz) ? body.tz : "America/New_York"));
    const card = await pullSingle(body.date, body.handle, buyer.id);
    if (!card) return NextResponse.json({ ok: false });
    const res = NextResponse.json({ ok: true, card });
    res.cookies.set(WINNER_COOKIE, winnerCookie(card.date, card.handle), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    if (!current) res.cookies.set(PLAYER_COOKIE, playerToken(buyer.id), PLAYER_COOKIE_OPTS);
    return res;
  } catch (e) {
    console.error("roster roll pull failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
