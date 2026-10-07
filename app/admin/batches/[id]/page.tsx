import Link from "next/link";
import { notFound } from "next/navigation";
import { CardTable } from "@/components/CardTable";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { QUEUE_ORDER, queueQuery, queueWhere } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import { PILE_LABEL, PILES } from "@/lib/types";
import { BatchActions } from "./BatchActions";
import { BatchPartner } from "./BatchPartner";
import { pdfSummaries } from "@/lib/pdfIngest";
import { ingestProgress } from "@/lib/ingestQueue";
import { IngestTicker } from "@/components/IngestTicker";

const PILE_HELP: Record<string, string> = {
  review: "Every card here is confident or already confirmed. Nice.",
  unpaired: "Every front found its back (or the batch is fronts only).",
  unreadable: "Every file opened fine.",
  likely_bulk: "No bulk flagged in this batch.",
  duplicate: "No repeats of cards you already have.",
  none: "All cards are in a review pile; check the other tabs.",
};

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pile?: string; skipped?: string }> }) {
  const { id } = await params;
  const { pile = "all", skipped } = await searchParams;
  const pdfs = await pdfSummaries(id);
  const ingesting = (await ingestProgress()).filter((p) => p.id === id);
  const batch = await db.batch.findUnique({ where: { id }, include: { _count: { select: { files: true } } } });
  if (!batch) notFound();
  const s = await getSettings();
  const queue = { batch: id, pile };
  const cards = await db.card.findMany({ where: await queueWhere(queue), orderBy: QUEUE_ORDER });
  const all = await db.card.findMany({ where: { batchId: id }, select: { pile: true, processedAt: true, partnerId: true, senderId: true, status: true } });
  const untagged = all.filter((c) => !c.partnerId && !c.senderId && c.status !== "Sold").length;
  const reviewCount = await db.card.count({ where: await queueWhere({ batch: id, pile: "review" }) });
  const unprocessed = all.filter((c) => !c.processedAt).length;
  const tabs: [string, string, number][] = [
    ["all", "All", all.length],
    ["review", "Needs review", reviewCount],
    ...PILES.map((p) => [p, PILE_LABEL[p], all.filter((c) => c.pile === p).length] as [string, string, number]),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/batches" className="text-xs font-semibold text-teal">← Batches</Link>
          <h1 className="text-2xl font-extrabold">{batch.name}</h1>
          <div className="text-sm text-navy/60">
            {batch._count.files} file(s) → {all.length} card(s) · pairing: {batch.pairMode} · {batch.createdAt.toLocaleString()}
          </div>
          <div className="mt-2">
            <IngestTicker initial={ingesting} batch={id} />
          </div>
          {skipped && <p className="mt-2 rounded bg-sand-2 p-2 text-sm">Skipped, already ingested: {skipped}</p>}
          {pdfs.map((p) => (
            <div key={p.id} className={`mt-2 rounded-lg p-2 text-sm ${p.needLook ? "bg-coral/10" : "bg-teal/10"}`}>
              <b>{p.name}</b>: {p.line}.
              {p.blankPages.length > 0 && ` Blank page${p.blankPages.length === 1 ? "" : "s"}: ${p.blankPages.join(", ")}.`}
            </div>
          ))}
          <BatchPartner batchId={id} value={batch.partnerId ? `f:${batch.partnerId}` : batch.senderId ? `s:${batch.senderId}` : null} untagged={untagged} />
          {batch.pairDecision &&
            (() => {
              const d = JSON.parse(batch.pairDecision) as { result: string; reason: string };
              const label = d.result === "fronts" ? "Auto: fronts only" : d.result === "pairs-backs-first" ? "Auto: paired (backs first)" : "Auto: paired front/back";
              return (
                <div className="mt-1 text-xs">
                  <span className="chip bg-teal/15 text-teal-2">{label}</span> <span className="text-navy/60">{d.reason}</span>
                </div>
              );
            })()}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BatchActions batchId={id} unprocessed={unprocessed} />
          <Link href={`/admin/flatbed?batch=${id}`} className="btn-ghost">+ Flatbed sheet</Link>
          {cards[0] && <Link href={`/admin/review/${cards[0].id}${queueQuery(queue)}`} className="btn-dark">Review this list →</Link>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {tabs.map(([key, label, n]) => (
          <Link key={key} href={`/admin/batches/${id}?pile=${key}`} className={`rounded-full px-3 py-1 text-sm font-semibold ${pile === key ? "bg-navy text-white" : "bg-white text-navy hover:bg-sand-2"}`}>
            {label} <span className="opacity-60">{n}</span>
          </Link>
        ))}
      </div>
      {cards.length ? (
        <CardTable cards={cards} threshold={s.confidenceThreshold} queue={queue} />
      ) : (
        <EmptyState title="Nothing in this pile">{PILE_HELP[pile] ?? "Pick another tab above."}</EmptyState>
      )}
    </div>
  );
}
