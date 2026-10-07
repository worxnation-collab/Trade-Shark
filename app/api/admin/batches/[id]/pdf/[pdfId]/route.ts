import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { ingestPdfPage } from "@/lib/pdfIngest";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Split one page of a registered PDF into card crops: { page } (1-based). One page per request. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string; pdfId: string }> }) => {
  const { id, pdfId } = await params;
  const { page } = (await req.json().catch(() => ({}))) as { page?: number };
  return NextResponse.json({ ok: true, ...(await ingestPdfPage(id, pdfId, Number(page))) });
});
