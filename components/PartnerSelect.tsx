"use client";

import { PARTNERS } from "@/lib/partners/split";

/** Matthew, Adrian or Mike. Uploads can't start without one. */
export function PartnerSelect({ value, onChange, allowNone = false, className = "input" }: { value: string; onChange: (v: string) => void; allowNone?: boolean; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Partner">
      <option value="">{allowNone ? "No partner (can't be packed)" : "Pick a partner…"}</option>
      {PARTNERS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
