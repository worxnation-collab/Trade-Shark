import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { repriceBatch } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Refresh quotes older than the stale window (default 24h), a chunk at a time. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const cursor = Number(new URL(req.url).searchParams.get("cursor") || 0);
  return NextResponse.json(await repriceBatch(id, cursor));
});
