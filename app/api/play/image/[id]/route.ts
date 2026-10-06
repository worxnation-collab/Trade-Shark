import { db } from "@/lib/db";
import { currentBuyer } from "@/lib/game/buyer";
import { readStored } from "@/lib/images";
import { presentCard } from "@/lib/present";
import { signedUrl, usingSupabase } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * A card's front, only for the player whose pack it's in (reserved, kept or bought blind).
 * A reserved pack is never shown to anyone else; stock and other players' packs 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buyer = await currentBuyer();
  if (!buyer) return new Response("not found", { status: 404 });
  const c = await db.card.findUnique({ where: { id }, select: { id: true, frontImage: true, frontDisplay: true, readable: true, gamePack: { select: { reservedBy: true, status: true } } } });
  const mine = c?.gamePack && c.gamePack.reservedBy === buyer.id && ["reserved", "kept", "sold-blind"].includes(c.gamePack.status);
  if (!c || !c.readable || !c.frontImage || !mine) return new Response("not found", { status: 404 });
  // The framed scan; made on first view for cards scanned before presentation existed (falls back to the raw scan).
  let rel = c.frontDisplay;
  if (!rel) {
    rel = await presentCard(c).catch((e) => (console.error("present failed", e), null));
    if (rel) await db.card.update({ where: { id: c.id }, data: { frontDisplay: rel } });
  }
  rel ??= c.frontImage;
  if (usingSupabase()) {
    const url = await signedUrl(rel, 600);
    if (!url) return new Response("not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  const img = await readStored(rel);
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.buf), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=600" } });
}
