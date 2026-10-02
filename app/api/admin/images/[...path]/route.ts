import { readStored } from "@/lib/images";
import { requireSession } from "@/lib/session";

/** Every stored scan, behind the password. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await requireSession())) return new Response("unauthorized", { status: 401 });
  const { path } = await params;
  const img = await readStored(path.join("/"));
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.buf), {
    headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=86400" },
  });
}
