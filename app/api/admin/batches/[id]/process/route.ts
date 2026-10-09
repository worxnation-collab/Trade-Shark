import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { processBatch } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Identify + price the next few unprocessed cards. The UI calls this in a loop and shows progress. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const limit = Number(new URL(req.url).searchParams.get("limit") || 1);
  return NextResponse.json(await processBatch(id, Math.min(25, Math.max(1, limit))));
});
