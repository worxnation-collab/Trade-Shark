import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/env";
import { ebayDraftCsv, tcgplayerCsv } from "@/lib/listing/export";
import { renderDescription, renderTitle } from "@/lib/listing/templates";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * Build a draft CSV and mark the exported cards Listed. Nothing is posted anywhere:
 * you upload the file yourself, publish in Seller Hub / TCGplayer, then paste the live URL back.
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ channel: string }> }) => {
  const { channel } = await params;
  if (channel !== "ebay" && channel !== "tcgplayer") return new Response("unknown channel", { status: 400 });
  const form = await req.formData();
  const ids = form.getAll("ids").map(String);
  const markListed = form.get("markListed") !== "0";
  const s = await getSettings();
  let cards = await db.card.findMany({ where: { id: { in: ids }, status: { in: ["Ready", "Listed"] }, readable: true }, orderBy: { pairId: "asc" } });
  if (channel === "tcgplayer") cards = cards.filter((c) => c.game === "Pokemon" || c.game === "Magic");
  // Freeze title/description at export time so the CSV matches what's on the card.
  for (const c of cards) {
    if (!c.title || !c.description) {
      const t = c.title || renderTitle(c, s);
      const d = c.description || renderDescription(c, s);
      await db.card.update({ where: { id: c.id }, data: { title: t, description: d } });
      c.title = t;
      c.description = d;
    }
  }
  const csv = channel === "ebay" ? ebayDraftCsv(cards, s, siteUrl()) : tcgplayerCsv(cards, s, siteUrl());
  if (markListed && cards.length) {
    const now = new Date();
    await db.card.updateMany({
      where: { id: { in: cards.map((c) => c.id) }, status: "Ready" },
      data: { status: "Listed", listedChannel: channel, listedAt: now, exportedAt: now },
    });
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trade-shark-${channel}-${stamp}.csv"`,
    },
  });
});
