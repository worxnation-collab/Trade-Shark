"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OwnerSelect } from "@/components/PartnerSelect";
import { CATEGORIES } from "@/lib/categories";

/** Chase cards for one category. Can't turn on until the category has a $10+ card scanned. */
export function ChaseToggle({ category, on, canTurnOn }: { category: string; on: boolean; canTurnOn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function flip() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/admin/game/chase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, on: !on }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) setErr(j.error || r.statusText);
    setBusy(false);
    router.refresh();
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <button className={on ? "btn-coral px-3 py-1" : "btn-ghost px-3 py-1"} disabled={busy || (!on && !canTurnOn)} onClick={flip} title={!canTurnOn && !on ? "Scan a $10+ card in this category first" : ""}>
        {on ? "Chase ON · turn off" : "Chase off · turn on"}
      </button>
      {err && <span className="text-xs text-coral">{err}</span>}
    </span>
  );
}

/** Set a card's category by hand (sticks through repricing). Empty = not packed. */
export function CategoryPicker({ cardId, value }: { cardId: string; value: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(category: string) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/admin/cards/${cardId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: category || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || r.statusText);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <span className="flex items-center gap-2">
      <select className="input py-1 text-xs" defaultValue={value ?? ""} disabled={busy} onChange={(e) => save(e.target.value)} aria-label="Pack category">
        <option value="">Not packed</option>
        {CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.product}
          </option>
        ))}
      </select>
      {err && <span className="text-xs text-coral">{err}</span>}
    </span>
  );
}

/** Set a card's owner (founder or sender) by hand. No owner = it can't go in a pack. `value` is "f:…" / "s:…". */
export function PartnerPicker({ cardId, value, locked = false }: { cardId: string; value: string | null; locked?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(partnerId: string) {
    setV(partnerId);
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/admin/cards/${cardId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner: partnerId || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || r.statusText);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  if (locked) return <span className="font-semibold text-navy">{value ?? "none"} (sold)</span>;
  return (
    <span className={`flex items-center gap-2 ${busy ? "opacity-60" : ""}`}>
      <OwnerSelect value={v} onChange={save} allowNone className={`input py-1 text-xs ${v ? "" : "border-coral"}`} />
      {err && <span className="text-xs text-coral">{err}</span>}
    </span>
  );
}
