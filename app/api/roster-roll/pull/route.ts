import { NextResponse } from "next/server";
import { pullSingle, WINNER_COOKIE, winnerCookie } from "@/lib/rosterRoll";

export const runtime = "nodejs";

/**
 * The winner's "Pull it.": one free single, once per date. On success this browser gets a signed cookie, so a refresh
 * still shows the card and the address link. Anything else answers { ok: false } and changes nothing.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { date?: unknown; handle?: unknown };
  try {
    const card = await pullSingle(body.date, body.handle);
    if (!card) return NextResponse.json({ ok: false });
    const res = NextResponse.json({ ok: true, card });
    res.cookies.set(WINNER_COOKIE, winnerCookie(card.date, card.handle), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    return res;
  } catch (e) {
    console.error("roster roll pull failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
