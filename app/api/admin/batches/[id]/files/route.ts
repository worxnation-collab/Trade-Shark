import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { storeBatchFiles } from "@/lib/pipeline";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Register uploaded scans.
 * - JSON { items: [{ name, rel }] }: files the browser already sent to Supabase Storage.
 * - multipart files/names: local-disk mode, a few files per request.
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const files: { name: string; buf: Uint8Array; rel?: string }[] = [];
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const { items } = (await req.json()) as { items: { name: string; rel: string }[] };
    for (const it of items) {
      if (!it.rel.startsWith(`${id}/incoming/`)) continue;
      const buf = await getObject(it.rel);
      if (buf) files.push({ name: it.name, buf, rel: it.rel });
    }
  } else {
    const form = await req.formData();
    const names = form.getAll("names").map(String);
    let i = 0;
    for (const v of form.getAll("files")) {
      if (typeof v === "string") continue;
      files.push({ name: names[i] || v.name, buf: new Uint8Array(await v.arrayBuffer()) });
      i++;
    }
  }
  const stored = await storeBatchFiles(id, files);
  return NextResponse.json({ stored: stored.length, unreadable: stored.filter((f) => !f.readable).length });
});
