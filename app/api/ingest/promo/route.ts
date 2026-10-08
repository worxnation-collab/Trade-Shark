import sharp from "sharp";
import { isCategory } from "@/lib/categories";
import { db } from "@/lib/db";
import { isEnergy } from "@/lib/game/packs";
import { getObject } from "@/lib/storage";
import { ingestKeyOk } from "@/lib/ingestInbox";

export const runtime = "nodejs";

/**
 * A promo photo grid for a Marketplace listing: the founder's top-priced cards in one category, as their framed scans
 * (no prices on the image). Key-protected like the ingest tick (x-ingest-key): scans never become public URLs.
 * Query: category, n (cards, up to 12), min (lowest price to include). Header x-cards lists the names, in order.
 */
export async function POST(req: Request) {
  if (!ingestKeyOk(req.headers.get("x-ingest-key"))) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? "";
  if (!isCategory(category)) return new Response("category?", { status: 400 });
  const n = Math.min(12, Math.max(1, Number(url.searchParams.get("n") || 9)));
  const min = Number(url.searchParams.get("min") || 1);
  const rows = await db.card.findMany({
    where: { category, listPrice: { gte: min }, status: { in: ["Priced", "LilStack", "BulkHold"] }, frontDisplay: { not: null } },
    orderBy: { listPrice: "desc" },
    take: n * 3,
    select: { name: true, player: true, number: true, frontDisplay: true },
  });
  const seen = new Set<string>();
  const picks = rows.filter((r) => !isEnergy(r.name) && !seen.has(`${r.name}|${r.number}`) && seen.add(`${r.name}|${r.number}`)).slice(0, n);
  const cols = picks.length <= 4 ? 2 : picks.length <= 9 ? 3 : 4;
  const cw = Math.floor(1080 / cols), ch = Math.round(cw * 1.4);
  const tiles = (
    await Promise.all(
      picks.map(async (p, i) => {
        const buf = await getObject(p.frontDisplay!).catch(() => null);
        if (!buf) return null;
        return { input: await sharp(buf).resize(cw - 16, ch - 16, { fit: "contain", background: "#F4EFE6" }).toBuffer(), left: (i % cols) * cw + 8, top: Math.floor(i / cols) * ch + 8 };
      }),
    )
  ).filter((t): t is NonNullable<typeof t> => !!t);
  const rowsN = Math.ceil(picks.length / cols);
  const img = await sharp({ create: { width: cols * cw, height: rowsN * ch, channels: 3, background: "#F4EFE6" } }).composite(tiles).jpeg({ quality: 90 }).toBuffer();
  return new Response(new Uint8Array(img), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "x-cards": encodeURIComponent(picks.map((p) => p.player || p.name).join(" | ")) },
  });
}
