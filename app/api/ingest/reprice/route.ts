import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestKeyOk } from "@/lib/ingestInbox";
import { priceCard } from "@/lib/pipeline";
import { autoPublish } from "@/lib/publish";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * Ask the price sources again for named cards that have no price (after a price key was added). Key-protected like
 * the ingest tick (x-ingest-key). A few cards per call; `since` (ISO time) skips cards already tried after it, so
 * calling until remaining = 0 tries each card once. Never sets a default: still nothing = still unpriced.
 */
export async function POST(req: Request) {
  if (!ingestKeyOk(req.headers.get("x-ingest-key"))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const since = new Date(url.searchParams.get("since") || Date.now() - 60_000);
  const game = url.searchParams.get("game"); // "Sports" | "Pokemon" | null for both
  const where = {
    listPrice: null,
    manualPrice: null,
    gamePackId: null,
    status: { in: ["Identified", "NeedsLook"] },
    OR: [{ name: { not: null } }, { player: { not: null } }],
    AND: [{ OR: [{ pricedAt: null }, { pricedAt: { lt: since } }] }, { OR: [{ identSource: null }, { identSource: { not: "filename" } }] }], // a filename guess isn't a name
    ...(game ? { game } : {}),
  };
  const s = await getSettings();
  const cards = await db.card.findMany({ where, orderBy: { createdAt: "asc" }, take: 6 });
  let priced = 0;
  for (const c of cards) {
    const card = await priceCard(c, s, { sources: ["pokemontcg", "pricecharting", "justtcg"], allowLivePriceChange: true });
    if (card.listPrice != null) {
      priced++;
      await autoPublish(card, s);
    }
    await new Promise((r) => setTimeout(r, 1100)); // PriceCharting: one call per second
  }
  const remaining = await db.card.count({ where });
  return NextResponse.json({ ok: true, tried: cards.length, priced, remaining });
}
