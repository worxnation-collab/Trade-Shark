import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { storeBatchFiles } from "@/lib/pipeline";

export const runtime = "nodejs";

/** Chunked upload: the browser posts a few files at a time so big scanner dumps don't hit one huge request. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const form = await req.formData();
  const files: { name: string; buf: Uint8Array }[] = [];
  const names = form.getAll("names").map(String);
  let i = 0;
  for (const v of form.getAll("files")) {
    if (typeof v === "string") continue;
    files.push({ name: names[i] || v.name, buf: new Uint8Array(await v.arrayBuffer()) });
    i++;
  }
  const stored = await storeBatchFiles(id, files);
  return NextResponse.json({ stored: stored.length, unreadable: stored.filter((f) => !f.readable).length });
});
