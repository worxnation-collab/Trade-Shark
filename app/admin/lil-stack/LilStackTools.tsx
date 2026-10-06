"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PartnerSelect } from "@/components/PartnerSelect";
import { CATEGORIES } from "@/lib/categories";

type Kind = "closed" | "open";

export function LilStackTools({ geminiReady, art }: { geminiReady: boolean; art: Partial<Record<Kind, string>> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [artMsg, setArtMsg] = useState("");
  const [artBusy, setArtBusy] = useState(false);
  const autoTried = useRef(false);

  async function rebuild() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/lil-stack/rebuild", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      const built = (j.built ?? []) as { category: string; built: number; available: number }[];
      setMsg(`Drew ${built.map((c) => `${c.category} +${c.built} (${c.available} ready)`).join(", ")}.`);
      router.refresh();
    } catch (e) {
      setMsg(`Rebuild failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function generate(kinds: Kind[]) {
    setArtBusy(true);
    const notes: string[] = [];
    for (const kind of kinds) {
      setArtMsg(`Drawing the ${kind} pack…`);
      try {
        const r = await fetch(`/api/admin/lil-stack/art?kind=${kind}`, { method: "POST" });
        const j = await r.json();
        notes.push(j.ok ? `${kind} pack ready` : `${kind}: ${j.reason || j.error}`);
      } catch (e) {
        notes.push(`${kind}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setArtMsg(notes.join(" · "));
    setArtBusy(false);
    router.refresh();
  }

  // First visit with a key and no art yet: draw the missing images once.
  useEffect(() => {
    if (autoTried.current || !geminiReady) return;
    const missing = (["closed", "open"] as Kind[]).filter((k) => !art[k]);
    if (!missing.length) return;
    autoTried.current = true;
    void generate(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiReady]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card space-y-2 p-4">
        <h2 className="font-bold">Packs</h2>
        <p className="text-sm text-navy/70">
          Packs are drawn on their own when a batch finishes or a reprice ends. Draw by hand after you sort cards or approve some: each category
          keeps up to 50 ready packs, and a draw that misses the value band is thrown out and drawn again.
        </p>
        <button className="btn-primary" disabled={busy} onClick={rebuild}>
          {busy ? "Drawing…" : "Draw packs"}
        </button>
        {msg && <p className="text-sm">{msg}</p>}
      </div>
      <div className="card space-y-2 p-4">
        <h2 className="font-bold">Pack art</h2>
        <div className="flex gap-3">
          {(["closed", "open"] as Kind[]).map((k) => (
            <figure key={k} className="w-24 text-center text-xs text-navy/60">
              {art[k] ? (
                <img src={art[k]} alt={`${k} pack`} className="aspect-[3/4] w-full rounded bg-navy object-cover" />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center rounded bg-navy/10">CSS pack</div>
              )}
              <figcaption>{k}</figcaption>
            </figure>
          ))}
        </div>
        {geminiReady ? (
          <button className="btn-ghost" disabled={artBusy} onClick={() => generate(["closed", "open"])}>
            {artBusy ? "Drawing…" : art.closed || art.open ? "Redraw with Gemini" : "Draw with Gemini"}
          </button>
        ) : (
          <p className="text-sm text-navy/70">
            Add <code className="rounded bg-sand-2 px-1">GEMINI_API_KEY</code> on Netlify to draw branded pack art. Until then the shop uses the CSS pack.
          </p>
        )}
        {artMsg && <p className="text-sm">{artMsg}</p>}
      </div>
    </div>
  );
}

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

/** Set a card's partner by hand. No partner = it can't go in a pack. */
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
      const r = await fetch(`/api/admin/cards/${cardId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partnerId: partnerId || null }) });
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
      <PartnerSelect value={v} onChange={save} allowNone className={`input py-1 text-xs ${v ? "" : "border-coral"}`} />
      {err && <span className="text-xs text-coral">{err}</span>}
    </span>
  );
}
