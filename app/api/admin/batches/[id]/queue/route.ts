import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { queueBatch } from "@/lib/ingestQueue";
import type { OrganizeInput } from "@/lib/pipeline";

export const runtime = "nodejs";

/** The upload is stored: queue it for background processing and say what arrived ("19 pages received."). */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Partial<OrganizeInput>;
  const pairMode = (["auto", "filename", "order", "fronts"] as const).find((m) => m === b.pairMode) ?? "auto";
  return NextResponse.json({ ok: true, ...(await queueBatch(id, { pairMode, manifest: b.manifest, pastedLines: b.pastedLines })) });
});
