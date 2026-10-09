"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function useDesk() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function post(path: string, body: unknown) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
      return j;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return { busy, msg, setMsg, post };
}

export function PlaceButton({ ids }: { ids: string[] }) {
  const { busy, msg, post } = useDesk();
  return (
    <div>
      <button className="btn-primary px-6 py-3 text-lg" disabled={busy || !ids.length} onClick={() => post("/api/admin/desk", { action: "placed", ids })}>
        {busy ? "Saving…" : `Placed ✓ (${ids.length})`}
      </button>
      {msg && <span className="ml-2 text-sm text-coral">{msg}</span>}
    </div>
  );
}

export function PackedButton({ id, label }: { id: string; label: string }) {
  const { busy, msg, post } = useDesk();
  return (
    <div className="flex flex-col gap-1">
      <button className="btn-primary px-5 py-3 text-base font-black" disabled={busy} onClick={() => post("/api/admin/desk", { action: "packed", packId: id })}>
        {busy ? "…" : `Packed: ${label}`}
      </button>
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </div>
  );
}

/** "List next 10": the founder caught up; the engine may list up to 10 more packs in this category. */
export function ListMore({ category }: { category: string }) {
  const { busy, msg, post } = useDesk();
  return (
    <span className="flex items-center gap-2">
      <button className="btn-dark px-5 py-2.5 text-base" disabled={busy} onClick={() => post("/api/admin/desk", { action: "list-more", category })}>
        {busy ? "…" : "List next 10"}
      </button>
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </span>
  );
}

/** One-tap rotate for a card the scanner wasn't sure about. Turns clockwise; ✓ = it's already upright. */
export function HoldFix({ id }: { id: string }) {
  const { busy, msg, post } = useDesk();
  const turn = (deg: number) => post(`/api/admin/cards/${id}/rotate?deg=${deg}`, {});
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {[
        [90, "↻"],
        [180, "↕ 180"],
        [270, "↺"],
        [0, "✓ upright"],
      ].map(([deg, label]) => (
        <button key={deg} className="rounded border border-navy/30 bg-white px-2 py-0.5 text-xs font-bold" disabled={busy} onClick={() => turn(deg as number)}>
          {label}
        </button>
      ))}
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </span>
  );
}

/** Unpriced column: type the price; saving it bins the card like any priced card (a manual price always wins). */
export function PriceBox({ id }: { id: string }) {
  const router = useRouter();
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async () => {
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (!(n > 0)) return setMsg("Type a price above $0.");
    setBusy(true);
    setMsg("");
    const r = await fetch(`/api/admin/cards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manualPrice: Math.round(n * 100) / 100 }) });
    setBusy(false);
    if (!r.ok) return setMsg("Didn't save. Try again.");
    router.refresh();
  };
  return (
    <span className="mt-1 flex items-center gap-1">
      <input
        className="w-20 rounded border border-navy/30 px-1.5 py-0.5 text-sm"
        inputMode="decimal"
        placeholder="$0.00"
        aria-label="Price"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <button className="rounded border border-navy/30 bg-white px-2 py-0.5 text-xs font-bold" disabled={busy || !v} onClick={save}>
        {busy ? "…" : "Save"}
      </button>
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </span>
  );
}

/** Facebook sale: pick a category, the next ready stack comes off the site; then pull it. */
export function FacebookSale() {
  const { busy, msg, post } = useDesk();
  const [cat, setCat] = useState("");
  const [sold, setSold] = useState<{ packId: string; label: string } | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto py-2 text-base" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">Category…</option>
          <option value="baseball">Baseball</option>
          <option value="football">Football</option>
          <option value="pokemon">Pokemon</option>
        </select>
        <button
          className="btn-dark px-5 py-2 text-base"
          disabled={busy || !cat}
          onClick={async () => {
            setSold(null);
            const j = await post("/api/admin/desk", { action: "facebook", category: cat });
            if (j) setSold({ packId: j.packId, label: j.label });
          }}
        >
          {busy ? "…" : "Sold on Facebook"}
        </button>
        {msg && <span className="text-sm font-semibold text-coral">{msg}</span>}
      </div>
      {sold && (
        <p className="text-xl font-black">
          Pull {sold.label} ·{" "}
          <a href={`/admin/packs/${sold.packId}`} className="underline">
            pull sheet
          </a>
        </p>
      )}
    </div>
  );
}

export function VoidFacebook({ id, label }: { id: string; label: string }) {
  const { busy, msg, post } = useDesk();
  return (
    <span className="flex items-center gap-2">
      <button className="text-xs text-navy/60 underline" disabled={busy} onClick={() => confirm(`Void the Facebook sale of ${label}? It goes back on the site.`) && post("/api/admin/desk", { action: "facebook-void", packId: id })}>
        Void
      </button>
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </span>
  );
}

/** eBay lane: list loose $3+ cards a few per call until none are left (or only this run's failures remain). */
export function EbayList({ ready }: { ready: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run() {
    setBusy(true);
    const since = Date.now();
    let listed = 0;
    let failed = 0;
    try {
      for (let i = 0; i < 100; i++) {
        const r = await fetch("/api/admin/desk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ebay-list", since }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
        listed += j.listed;
        failed += j.failed.length;
        setMsg(`Listed ${listed}${failed ? `, ${failed} failed (still in stock)` : ""}${j.left ? ` · ${j.left} to go…` : ""}`);
        if (!j.left || (!j.listed && !j.failed.length)) break;
        if (j.failed.length && /connected|policy|login/.test(j.failed[0].error)) break;
      }
      setMsg((m) => m.replace(/ · \d+ to go…$/, "") + ". Done.");
    } catch (e) {
      setMsg(`eBay didn't answer: ${e instanceof Error ? e.message : String(e)}. Cards stay in stock.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-primary px-5 py-2 text-base" disabled={busy || !ready} onClick={run}>
        {busy ? "Listing…" : `List ${ready} card${ready === 1 ? "" : "s"} on eBay`}
      </button>
      {msg && <span className="text-sm font-semibold">{msg}</span>}
    </div>
  );
}

export function EbayDisconnect() {
  const { busy, post } = useDesk();
  return (
    <button className="text-sm text-navy/60 underline" disabled={busy} onClick={() => confirm("Disconnect the eBay seller login? Listed cards stay listed.") && post("/api/admin/desk", { action: "ebay-disconnect" })}>
      Disconnect eBay
    </button>
  );
}
