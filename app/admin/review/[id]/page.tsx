import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { renderDescription, renderTitle } from "@/lib/listing/templates";
import { latestPerSource, suggest, type QuoteRow } from "@/lib/pricing/engine";
import { QUEUE_ORDER, queueQuery, queueWhere, type QueueParams } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import type { IdentCandidate, IdentField } from "@/lib/types";
import { safeJson } from "@/lib/util";
import { ReviewScreen } from "./ReviewScreen";

export const metadata = { title: "Review" };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<QueueParams> }) {
  const { id } = await params;
  const queue = await searchParams;
  const card = await db.card.findUnique({ where: { id }, include: { batch: true } });
  if (!card) notFound();
  const s = await getSettings();

  const ids = (await db.card.findMany({ where: await queueWhere(queue), orderBy: QUEUE_ORDER, select: { id: true } })).map((c) => c.id);
  const pos = ids.indexOf(id);
  const prevId = pos > 0 ? ids[pos - 1] : null;
  const nextId = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null;

  const quotes = (await db.priceQuote.findMany({ where: { cardId: id }, orderBy: { fetchedAt: "desc" } })) as QuoteRow[];
  const latest = latestPerSource(quotes);
  const sug = suggest(quotes, card, s);
  const runs = await db.sourceRun.findMany({ where: { cardId: id }, orderBy: { at: "desc" }, take: 40 });
  const dupOf = card.duplicateOfId
    ? await db.card.findUnique({ where: { id: card.duplicateOfId }, select: { id: true, name: true, setName: true, number: true, status: true, frontImage: true, batch: { select: { name: true } } } })
    : null;

  // Dates become strings crossing to the client component.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ser = (x: unknown): any => JSON.parse(JSON.stringify(x));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-3">
          <Link href={queue.batch ? `/admin/batches/${queue.batch}?pile=${queue.pile ?? "all"}` : `/admin/cards${queueQuery(queue)}`} className="font-semibold text-teal">
            ← Back to list
          </Link>
          <span className="text-navy/50">
            {pos >= 0 ? `${pos + 1} of ${ids.length}` : "not in this list"} · batch <Link href={`/admin/batches/${card.batchId}`} className="underline">{card.batch.name}</Link>
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-navy/60">
          <span><kbd>J</kbd> next</span>
          <span><kbd>K</kbd> prev</span>
          <span><kbd>Enter</kbd> save + next</span>
          <span><kbd>F</kbd> flip</span>
        </div>
      </div>
      <ReviewScreen
        key={card.id}
        card={ser(card)}
        settings={s}
        alternates={safeJson<IdentCandidate[]>(card.identAlternates, [])}
        seeds={safeJson<IdentCandidate[]>(card.seedCandidates, [])}
        fieldConfidence={safeJson<Partial<Record<IdentField, number>>>(card.fieldConfidence, {})}
        latest={ser(latest)}
        historyCount={quotes.length - latest.length}
        suggestion={ser(sug)}
        runs={ser(runs)}
        dupOf={ser(dupOf)}
        prevId={prevId}
        nextId={nextId}
        qs={queueQuery(queue)}
        defaultTitle={renderTitle(card, s)}
        defaultDescription={renderDescription(card, s)}
      />
    </div>
  );
}
