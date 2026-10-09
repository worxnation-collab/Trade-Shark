import { NextResponse } from "next/server";
import { pullSingle } from "@/lib/rosterRoll";

export const runtime = "nodejs";

/** The winner's "Pull it.": one free single, once per date. Anything else answers { ok: false } and changes nothing. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { date?: unknown; handle?: unknown };
  try {
    const card = await pullSingle(body.date, body.handle);
    return NextResponse.json(card ? { ok: true, card } : { ok: false });
  } catch (e) {
    console.error("roster roll pull failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
