import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recordWinner } from "@/lib/rosterRoll";

export const runtime = "nodejs";

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * Roster Roll records the day's winner: { date: "YYYY-MM-DD" (America/New_York), handle, score }, with
 * `Authorization: Bearer <ROSTER_ROLL_KEY>`. The only writer of RosterRollClaim. 201 recorded, 409 that date already
 * has a winner, 400 bad input, 401 wrong key, 503 no key set on the server.
 */
export async function POST(req: Request) {
  const key = process.env.ROSTER_ROLL_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "ROSTER_ROLL_KEY is not set" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !timingSafeEqual(sha(given), sha(key))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "send JSON: { date, handle, score }" }, { status: 400 });
  const r = await recordWinner(body);
  return r.ok ? NextResponse.json({ ok: true }, { status: 201 }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
