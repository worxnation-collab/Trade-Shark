"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
      const cats = (j.categories ?? []) as { category: string; packs: number; waiting: number }[];
      setMsg(`Rebuilt: ${cats.map((c) => `${c.category} ${c.packs} pack${c.packs === 1 ? "" : "s"} (${c.waiting} waiting)`).join(", ")}.`);
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
          Packs build on their own when a batch finishes or a reprice ends. Rebuild by hand after you sort cards or change prices: changed packs get a fresh
          pay link, unchanged ones keep theirs.
        </p>
        <button className="btn-primary" disabled={busy} onClick={rebuild}>
          {busy ? "Rebuilding…" : "Rebuild packs"}
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

/** Per-pack: pay link, mark sold by hand, fresh link. */
export function PackActions({ id, linkUrl, linkError, price }: { id: string; linkUrl: string | null; linkError: string | null; price: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setErr("");
    try {
      const r = await fetch(`/api/admin/lil-stack/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (!r.ok || j.ok === false) setErr(j.error || j.note || r.statusText);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      router.refresh();
    }
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noreferrer" className="chip bg-teal/15 text-teal-2 underline">
          Pay link ↗
        </a>
      ) : (
        <span className="chip bg-coral/15 text-coral" title={linkError ?? ""}>
          No pay link{linkError ? `: ${linkError.slice(0, 80)}` : ""}
        </span>
      )}
      <button className="btn-ghost px-2 py-1 text-xs" disabled={!!busy} onClick={() => act("relink")}>
        {busy === "relink" ? "Linking…" : linkUrl ? "New link" : "Create link"}
      </button>
      <button
        className="btn-ghost px-2 py-1 text-xs text-coral"
        disabled={!!busy}
        onClick={() => {
          const v = prompt("Sold by hand. Amount received ($)?", price != null ? String(price) : "");
          if (v !== null) void act("sold", { amount: v });
        }}
      >
        Mark sold
      </button>
      {err && <span className="text-xs text-coral">{err}</span>}
    </div>
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
