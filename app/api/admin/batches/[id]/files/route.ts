import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { storeBatchFiles, type SheetMeta } from "@/lib/pipeline";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Register uploaded scans.
 * - JSON { items: [{ name, rel, meta? }] }: files the browser already sent to Supabase Storage.
 * - multipart files/names/meta: local-disk mode, a few files per request.
 * `meta` carries flatbed info: crop pairing (pairKey + side) or kind "sheet" for the original scan.
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const files: { name: string; buf: Uint8Array; rel?: string; meta?: SheetMeta }[] = [];
  const parseMeta = (v: unknown): SheetMeta | undefined => {
    if (!v) return undefined;
    try {
      const m = (typeof v === "string" ? JSON.parse(v) : v) as SheetMeta;
      return {
        kind: m.kind === "sheet" ? "sheet" : m.kind === "crop" ? "crop" : undefined,
        pairKey: typeof m.pairKey === "string" ? m.pairKey.slice(0, 80) : undefined,
        side: m.side === "back" ? "back" : m.side === "front" ? "front" : undefined,
        sheetName: typeof m.sheetName === "string" ? m.sheetName.slice(0, 200) : undefined,
        sheetRel: typeof m.sheetRel === "string" && m.sheetRel.startsWith(`${id}/`) ? m.sheetRel : undefined,
        sheetHash: typeof m.sheetHash === "string" ? m.sheetHash.slice(0, 64) : undefined,
        cropIndex: Number.isInteger(m.cropIndex) ? m.cropIndex : undefined,
        cropBox: m.cropBox,
        page: Number.isInteger(m.page) ? m.page : undefined,
        pdfId: typeof m.pdfId === "string" ? m.pdfId.slice(0, 40) : undefined,
        trim: m.trim === true,
      };
    } catch {
      return undefined;
    }
  };
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const { items } = (await req.json()) as { items: { name: string; rel: string; meta?: unknown }[] };
    for (const it of items) {
      if (!it.rel.startsWith(`${id}/incoming/`)) continue;
      const buf = await getObject(it.rel);
      if (buf) files.push({ name: it.name, buf, rel: it.rel, meta: parseMeta(it.meta) });
    }
  } else {
    const form = await req.formData();
    const names = form.getAll("names").map(String);
    const metas = form.getAll("meta").map(String);
    let i = 0;
    for (const v of form.getAll("files")) {
      if (typeof v === "string") continue;
      files.push({ name: names[i] || v.name, buf: new Uint8Array(await v.arrayBuffer()), meta: parseMeta(metas[i]) });
      i++;
    }
  }
  const stored = await storeBatchFiles(id, files);
  return NextResponse.json({
    stored: stored.length,
    unreadable: stored.filter((f) => !f.readable).length,
    files: stored.map((f) => ({ id: f.id, name: f.name, rel: f.rel, hash: f.hash })),
  });
});
