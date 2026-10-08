import { caseWhere } from "@/lib/caseStock";
import { db } from "@/lib/db";
import { readStored } from "@/lib/images";
import { presentCard } from "@/lib/present";
import { signedUrl, usingSupabase } from "@/lib/storage";

export const runtime = "nodejs";

/** The framed scan of a card in The case. Only loose stock: once a pack takes the card, this 404s. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.card.findFirst({ where: { id, ...caseWhere }, select: { id: true, frontImage: true, frontDisplay: true } });
  if (!c?.frontImage) return new Response("not found", { status: 404 });
  let rel = c.frontDisplay;
  if (!rel) {
    rel = await presentCard(c).catch((e) => (console.error("present failed", e), null));
    if (rel) await db.card.update({ where: { id: c.id }, data: { frontDisplay: rel } });
  }
  rel ??= c.frontImage;
  if (usingSupabase()) {
    const url = await signedUrl(rel, 900);
    if (!url) return new Response("not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=600" } });
  }
  const img = await readStored(rel);
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.buf), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=600" } });
}
