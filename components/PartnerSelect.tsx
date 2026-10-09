"use client";

import { useEffect, useState } from "react";
import { PARTNERS } from "@/lib/partners/split";

type Owners = { founders: { id: string; name: string }[]; senders: { id: string; name: string }[]; consignOpen: boolean };

/**
 * Whose cards: a founder ("f:matthew") or a consignment sender ("s:<id>"). Uploads can't start without one.
 * Sender tags only show while consignment is unlocked.
 */
export function OwnerSelect({ value, onChange, allowNone = false, className = "input" }: { value: string; onChange: (v: string) => void; allowNone?: boolean; className?: string }) {
  const [o, setO] = useState<Owners>({ founders: [...PARTNERS], senders: [], consignOpen: false });
  useEffect(() => {
    fetch("/api/admin/owners")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setO(j))
      .catch(() => {});
  }, []);
  const known = !value || value.startsWith("f:") || o.senders.some((s) => `s:${s.id}` === value);
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Owner">
      <option value="">{allowNone ? "No owner (can't be packed)" : "Pick an owner…"}</option>
      <optgroup label="Founder">
        {o.founders.map((p) => (
          <option key={p.id} value={`f:${p.id}`}>
            {p.name}
          </option>
        ))}
      </optgroup>
      <optgroup label={o.consignOpen ? "Consignment sender" : "Consignment (locked)"}>
        {o.senders.map((s) => (
          <option key={s.id} value={`s:${s.id}`}>
            {s.name}
          </option>
        ))}
        {!known && <option value={value}>Consignment sender</option>}
      </optgroup>
    </select>
  );
}
