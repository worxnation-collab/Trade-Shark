import { NextResponse } from "next/server";
import { ingestProgress, tick, tickKey } from "@/lib/ingestQueue";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Do some background ingest work (a few pages / cards) and report progress. Called by the open desk (signed in) and
 * by the scheduled function (x-ingest-key). GET only reports progress.
 */
export async function POST(req: Request) {
  const ok = (await requireSession()) || req.headers.get("x-ingest-key") === tickKey();
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const batch = new URL(req.url).searchParams.get("batch") ?? undefined;
  return NextResponse.json(await tick(18_000, batch));
}

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ progress: await ingestProgress() });
}
