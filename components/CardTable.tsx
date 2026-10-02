import Link from "next/link";
import { ConfidenceChip, PileChip, StatusChip } from "@/components/StatusChip";
import type { Card } from "@prisma/client";
import { queueQuery, type QueueParams } from "@/lib/queue";
import { money } from "@/lib/util";

export function CardTable({ cards, threshold, queue }: { cards: Card[]; threshold: number; queue: QueueParams }) {
  const qs = queueQuery(queue);
  return (
    <div className="card overflow-x-auto">
      <table className="grid-table">
        <thead>
          <tr>
            <th></th>
            <th>Pair</th>
            <th>Card</th>
            <th>Game</th>
            <th>ID</th>
            <th>Source</th>
            <th className="text-right">Price</th>
            <th>Status</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} className="transition-colors hover:bg-sand/60">
              <td className="w-12">
                <Link href={`/admin/review/${c.id}${qs}`}>
                  {c.frontImage && c.readable ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/admin/images/${c.frontImage}`} alt="" className="h-14 w-10 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-14 w-10 items-center justify-center rounded bg-sand-2 text-[10px] text-navy/50">?</div>
                  )}
                </Link>
              </td>
              <td className="font-mono text-xs text-navy/60">{c.pairId}</td>
              <td>
                <Link href={`/admin/review/${c.id}${qs}`} className="font-semibold hover:text-teal">
                  {c.player || c.name || <span className="text-navy/40">{c.frontOrigName ?? "Unknown"}</span>}
                </Link>
                <div className="text-xs text-navy/60">{[c.year, c.setName, c.number && `#${c.number}`, c.variant].filter(Boolean).join(" · ")}</div>
              </td>
              <td>{c.game}</td>
              <td><ConfidenceChip value={c.sourceConfidence} threshold={threshold} confirmed={!!c.confirmedAt} /></td>
              <td className="text-xs text-navy/60">{c.identSource ?? "—"}</td>
              <td className="text-right">
                <div className="font-semibold">{money(c.listPrice)}</div>
                <div className="text-[11px] text-navy/50">{c.suggestedSource}</div>
              </td>
              <td><StatusChip status={c.status} /></td>
              <td className="space-x-1">
                <PileChip pile={c.pile} />
                {c.paymentLinkActive && <span className="chip bg-teal text-white">pay link</span>}
                {c.priceConflict && <span className="chip bg-coral/15 text-coral">price conflict</span>}
                {c.identConflict && <span className="chip bg-coral/15 text-coral">ID conflict</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
