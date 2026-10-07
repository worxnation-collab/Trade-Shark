import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { recordPdfPage } from "@/lib/pdfIngest";

export const runtime = "nodejs";

/** A page the browser couldn't read: { page, note }. Recorded so it's flagged, never silently dropped. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ pdfId: string }> }) => {
  const { pdfId } = await params;
  const b = (await req.json().catch(() => ({}))) as { page?: number; note?: string };
  await recordPdfPage(pdfId, Number(b.page), { note: String(b.note ?? "couldn't read this page").slice(0, 120) });
  return NextResponse.json({ ok: true });
});
