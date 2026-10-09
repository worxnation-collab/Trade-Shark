import { db } from "./db";
import { readStored } from "./images";
import { presentCard } from "./present";
import { signedUrl, usingSupabase } from "./storage";

/** Serve a card's framed scan (made on first view if missing). The caller decides whether this viewer may see it. */
export async function framedImageResponse(c: { id: string; frontImage: string | null; frontDisplay: string | null }): Promise<Response> {
  if (!c.frontImage) return new Response("not found", { status: 404 });
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
