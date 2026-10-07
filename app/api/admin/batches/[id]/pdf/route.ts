import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { registerPdf } from "@/lib/pdfIngest";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Register a PDF of scanned cards. JSON { rel, name } (the browser already put it in Storage) or multipart `file`
 * (local mode). Returns { pdfId, pages }, or { skipped } when this exact PDF was ingested before.
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  let name = "scan.pdf";
  let buf: Uint8Array | null = null;
  let rel: string | undefined;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const b = (await req.json()) as { rel?: string; name?: string };
    if (!b.rel?.startsWith(`${id}/incoming/`)) return NextResponse.json({ ok: false, error: "bad upload path" }, { status: 400 });
    rel = b.rel;
    name = String(b.name ?? name).slice(0, 200);
    buf = await getObject(b.rel);
  } else {
    const f = (await req.formData()).get("file");
    if (f && typeof f !== "string") {
      name = f.name;
      buf = new Uint8Array(await f.arrayBuffer());
    }
  }
  if (!buf || Buffer.from(buf.subarray(0, 5)).toString("latin1") !== "%PDF-")
    return NextResponse.json({ ok: false, error: `${name} isn't a PDF the engine can read.` }, { status: 422 });
  try {
    return NextResponse.json({ ok: true, ...(await registerPdf(id, name, buf, rel)) });
  } catch (e) {
    console.error("pdf register failed", e);
    return NextResponse.json({ ok: false, error: `${name} couldn't be opened as a PDF.` }, { status: 422 });
  }
});
