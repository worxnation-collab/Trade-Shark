import { db } from "@/lib/db";
import { readStored } from "@/lib/images";
import { signedUrl, usingSupabase } from "@/lib/storage";

/**
 * Public image route: serves a card's front ONLY while it sits in an open pack.
 * The raw image store is never exposed; stock, Inbox, Sold and Archived cards 404 here.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; side: string }> }) {
  const { id, side } = await params;
  if (side !== "front") return new Response("not found", { status: 404 });
  const c = await db.card.findUnique({ where: { id }, select: { status: true, frontImage: true, backImage: true, readable: true, lilStackId: true } });
  // Only cards sitting in a pack, front only: packs are the only thing for sale.
  const shown = c?.status === "LilStack" && !!c.lilStackId;
  if (!c || !c.readable || !shown) return new Response("not found", { status: 404 });
  const rel = c.frontImage;
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
