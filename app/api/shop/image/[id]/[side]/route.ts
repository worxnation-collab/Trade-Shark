import { db } from "@/lib/db";
import { readStored } from "@/lib/images";
import { signedUrl, usingSupabase } from "@/lib/storage";
import { FOR_SALE } from "@/lib/types";

/**
 * Public image route: serves a scan ONLY while its card is for sale.
 * The raw image store is never exposed; Inbox/Sold/Archived cards 404 here.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; side: string }> }) {
  const { id, side } = await params;
  const c = await db.card.findUnique({ where: { id }, select: { status: true, frontImage: true, backImage: true, readable: true } });
  if (!c || !c.readable || !FOR_SALE.includes(c.status as never)) return new Response("not found", { status: 404 });
  const rel = side === "back" ? c.backImage : c.frontImage;
  if (rel && usingSupabase()) {
    // Signed URL expires in an hour; the redirect itself is cached briefly so a sold card disappears fast.
    const url = await signedUrl(rel, 3600);
    if (!url) return new Response("not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "public, max-age=600" } });
  }
  const img = rel ? await readStored(rel) : null;
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.buf), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=3600" },
  });
}
