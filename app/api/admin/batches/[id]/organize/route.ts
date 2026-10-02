import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import type { PairMode } from "@/lib/organize/pairing";
import { organizeBatch } from "@/lib/pipeline";

export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { pairMode?: PairMode; manifest?: string; pastedLines?: string };
  const pairMode = (["auto", "filename", "order", "fronts"] as const).includes(body.pairMode as PairMode) ? body.pairMode! : "auto";
  const r = await organizeBatch(id, { pairMode, manifest: body.manifest, pastedLines: body.pastedLines });
  return NextResponse.json(r);
});
