import { ART_KINDS, readArt, type ArtKind } from "@/lib/brandArt";

export const runtime = "nodejs";

/** Public Lil' Stack pack art (brand images only, never scans). 404 means "draw the CSS pack". */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(ART_KINDS as readonly string[]).includes(kind)) return new Response("not found", { status: 404 });
  const art = await readArt(kind as ArtKind).catch(() => null);
  if (!art) return new Response("not found", { status: 404 });
  if ("url" in art) return new Response(null, { status: 302, headers: { Location: art.url, "Cache-Control": "public, max-age=1800" } });
  return new Response(new Uint8Array(art.buf), { headers: { "Content-Type": art.mime, "Cache-Control": "public, max-age=86400" } });
}
