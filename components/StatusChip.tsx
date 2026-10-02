import { PILE_LABEL, STATUS_LABEL, type Pile, type Status } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  Inbox: "bg-navy/10 text-navy",
  Identified: "bg-teal/15 text-teal-2",
  Priced: "bg-teal/25 text-teal-2",
  Ready: "bg-teal text-white",
  Listed: "bg-navy text-white",
  Sold: "bg-coral text-white",
  Archived: "bg-navy/5 text-navy/50",
  BulkHold: "bg-sand-2 text-navy/70",
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${STATUS_STYLE[status] ?? "bg-navy/10"}`}>{STATUS_LABEL[status as Status] ?? status}</span>;
}

export function PileChip({ pile }: { pile: string }) {
  if (pile === "none") return null;
  return <span className="chip bg-coral/15 text-coral">{PILE_LABEL[pile as Pile] ?? pile}</span>;
}

export function ConfidenceChip({ value, threshold, confirmed }: { value: number; threshold: number; confirmed?: boolean }) {
  if (confirmed) return <span className="chip bg-teal/15 text-teal-2">✓ confirmed</span>;
  const ok = value >= threshold;
  return <span className={`chip ${ok ? "bg-teal/15 text-teal-2" : "bg-coral/15 text-coral"}`}>{Math.round(value * 100)}%</span>;
}
