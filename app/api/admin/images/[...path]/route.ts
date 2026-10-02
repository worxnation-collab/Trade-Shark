import { readStored } from "@/lib/images";
import { requireSession } from "@/lib/session";
import { signedUrl, usingSupabase } from "@/lib/storage";

/** Every stored scan, behind the password. On Supabase: a 1-hour signed URL instead of streaming bytes. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await requireSession())) return new Response("unauthorized", { status: 401 });
  const { path } = await params;
  const rel = path.join("/");
  if (usingSupabase()) {
    const url = await signedUrl(rel, 3600);
    if (!url) return new Response("not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=1800" } });
  }
  const img = await readStored(rel);
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.buf), {
    headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=86400" },
  });
}
