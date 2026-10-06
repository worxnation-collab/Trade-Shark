"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Mark shipped. A stamped envelope says "no tracking" instead of asking for a number. */
export function ShipForm({ kind, id, pwe }: { kind: "card" | "stack" | "game" | "parcel"; id: string; pwe: boolean }) {
  const router = useRouter();
  const [tracking, setTracking] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function ship(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/admin/orders/ship", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, tracking }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) return setErr(j.error ?? r.statusText);
    router.refresh();
  }
  return (
    <form onSubmit={ship} className="space-y-1">
      {kind === "parcel" ? null : pwe ? (
        <p className="text-sm text-navy/60">Stamped envelope: no tracking.</p>
      ) : (
        <input className="input font-mono" placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="Tracking number" />
      )}
      <button className={kind === "parcel" ? "btn-ghost" : "btn-primary"} disabled={busy || (!pwe && !tracking.trim())}>
        {busy ? "Saving…" : kind === "parcel" ? "Dropped off" : "Mark shipped"}
      </button>
      {err && <p className="text-xs text-coral">{err}</p>}
    </form>
  );
}
