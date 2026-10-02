import Link from "next/link";
import { notFound } from "next/navigation";
import { CardTable } from "@/components/CardTable";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { QUEUE_ORDER, queueQuery, queueWhere } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import { PILE_LABEL, PILES } from "@/lib/types";
import { BatchActions } from "./BatchActions";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pile?: string }> }) {
  const { id } = await params;
  const { pile = "all" } = await searchParams;
  const batch = await db.batch.findUnique({ where: { id }, include: { _count: { select: { files: true } } } });
  if (!batch) notFound();
  const s = await getSettings();
  const queue = { batch: id, pile };
  const cards = await db.card.findMany({ where: await queueWhere(queue), orderBy: QUEUE_ORDER });
  const all = await db.card.findMany({ where: { batchId: id }, select: { pile: true, processedAt: true } });
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BatchActions batchId={id} unprocessed={unprocessed} />
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
      {cards.length ? <CardTable cards={cards} threshold={s.confidenceThreshold} queue={queue} /> : <EmptyState title="Nothing in this pile" />}
    </div>
  );
}
