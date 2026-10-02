import Link from "next/link";
import { CardTable } from "@/components/CardTable";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { QUEUE_ORDER, queueQuery, queueWhere, type QueueParams } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import { STATUS_LABEL, STATUSES } from "@/lib/types";

export const metadata = { title: "Inventory" };

export default async function Inventory({ searchParams }: { searchParams: Promise<QueueParams> }) {
  const p = await searchParams;
  const s = await getSettings();
  const cards = await db.card.findMany({ where: await queueWhere(p), orderBy: QUEUE_ORDER, take: 500 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Inventory</h1>
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={p.q} placeholder="Search" className="input w-48" />
          <select name="status" defaultValue={p.status ?? ""} className="input w-36">
            <option value="">Any status</option>
            {STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
          <select name="filter" defaultValue={p.filter ?? ""} className="input w-44">
            <option value="">No filter</option>
            <option value="noprice">Missing a price</option>
            <option value="conflict">Conflicting sources</option>
          </select>
          <select name="pile" defaultValue={p.pile ?? ""} className="input w-40">
            <option value="">Any pile</option>
            <option value="review">Needs review</option>
            <option value="unpaired">Unpaired</option>
            <option value="unreadable">Unreadable</option>
            <option value="likely_bulk">Likely bulk</option>
            <option value="duplicate">Duplicate</option>
          </select>
          <button className="btn-dark">Filter</button>
          {cards[0] && <Link href={`/admin/review/${cards[0].id}${queueQuery(p)}`} className="btn-primary">Review list →</Link>}
        </form>
      </div>
      {cards.length ? <CardTable cards={cards} threshold={s.confidenceThreshold} queue={p} /> : <EmptyState title="No cards match">Clear a filter, or upload a batch to fill the tank.</EmptyState>}
    </div>
  );
}
