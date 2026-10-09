import { db } from "@/lib/db";
import { siteUrl } from "@/lib/env";
import { cardLabel } from "@/lib/shop";
import { ExportForm } from "./ExportForm";

export const metadata = { title: "Export" };

export default async function ExportPage() {
  const ready = await db.card.findMany({ where: { status: "Ready" }, orderBy: [{ batchId: "asc" }, { pairId: "asc" }] });
  const awaiting = await db.card.findMany({ where: { status: "Listed", listedUrl: null }, orderBy: { listedAt: "desc" } });
  const row = (c: (typeof ready)[number]) => ({ id: c.id, label: cardLabel(c), game: c.game, price: c.listPrice, pairId: c.pairId, status: c.status, listedUrl: c.listedUrl, listedChannel: c.listedChannel });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Export listings</h1>
      {!siteUrl() && (
        <p className="rounded bg-sand-2 p-2 text-sm">
          SITE_URL isn&apos;t set, so the eBay CSV has no photo URLs. Set it to your public shop URL to fill PicURL automatically, or add photos in Seller Hub.
        </p>
      )}
      <ExportForm ready={ready.map(row)} awaitingUrl={awaiting.map(row)} />
    </div>
  );
}
