import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { registerPdf } from "@/lib/pdfIngest";

export const runtime = "nodejs";

/** Register a PDF before its pages are sent: { name, hash (sha-256), pages }. { skipped } if it was ingested before. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { name?: string; hash?: string; pages?: number };
  const hash = String(b.hash ?? "");
  if (!/^[a-f0-9]{64}$/.test(hash) || !(Number(b.pages) > 0)) return NextResponse.json({ ok: false, error: "That PDF couldn't be read." }, { status: 422 });
  return NextResponse.json({ ok: true, ...(await registerPdf(id, String(b.name ?? "scan.pdf").slice(0, 200), hash, Math.min(2000, Number(b.pages)))) });
});
