import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { signedUpload, usingSupabase } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Step 1 of a direct upload: hand the browser signed Supabase upload URLs so scans skip the
 * serverless request-size limit. Local-disk mode answers { mode: "multipart" } instead.
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!usingSupabase()) return NextResponse.json({ mode: "multipart" });
  const { names } = (await req.json()) as { names: string[] };
  const items = [];
  for (const name of names.slice(0, 50)) {
    const ext = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "bin").toLowerCase();
    const rel = `${id}/incoming/${randomUUID()}.${ext}`;
    const t = await signedUpload(rel);
    items.push({ name, rel, signedUrl: t!.signedUrl });
  }
  return NextResponse.json({ mode: "direct", items });
});
