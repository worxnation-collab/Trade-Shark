import { NextResponse } from "next/server";
import { ingestKeyOk, receiveFile } from "@/lib/ingestInbox";

export const runtime = "nodejs";

/**
 * Take one scan from outside the desk (e.g. a Google Drive script). Header x-ingest-key = sha-256 hex of
 * "ingest:" + INGEST_KEY. Body: the raw file (JPG, PNG or PDF, up to 5.5 MB), or multipart with a "file" field.
 * Query: owner=matthew|adrian|mike (required), name=<file name>.
 */
export async function POST(req: Request) {
  if (!ingestKeyOk(req.headers.get("x-ingest-key"))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  let name = url.searchParams.get("name") ?? "";
  let owner = url.searchParams.get("owner") ?? "";
  let buf: Uint8Array;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const f = form.get("file");
    if (!f || typeof f === "string") return NextResponse.json({ ok: false, error: "no file field" }, { status: 400 });
    buf = new Uint8Array(await f.arrayBuffer());
    name ||= f.name;
    owner ||= String(form.get("owner") ?? "");
  } else buf = new Uint8Array(await req.arrayBuffer());
  const r = await receiveFile({ name, buf, owner });
  const { status, ...body } = r;
  return NextResponse.json(body, { status });
}
