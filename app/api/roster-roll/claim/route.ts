import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recordWinner } from "@/lib/rosterRoll";

export const runtime = "nodejs";

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * Roster Roll records the day's winner: { date, handle, score, code, kind? }. kind defaults to "lineup".
 * "pack" is the Pack Rip winner, a second row for the same date. `Authorization: Bearer <ROSTER_ROLL_KEY>`.
 */
export async function POST(req: Request) {
  const key = process.env.ROSTER_ROLL_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "ROSTER_ROLL_KEY is not set" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !timingSafeEqual(sha(given), sha(key))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "send JSON: { date, handle, score, code }" }, { status: 400 });
  const r = await recordWinner(body);
  return r.ok ? NextResponse.json({ ok: true }, { status: 201 }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
