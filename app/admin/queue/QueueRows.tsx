"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { confetti } from "@/lib/client/feel";
import { money } from "@/lib/util";

async function patch(id: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/admin/cards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error ?? r.statusText);
  return j as { wentLive?: boolean };
}

function Thumb({ image, v }: { image: string | null; v?: number }) {
  // ?v= busts the browser cache after a card is turned.
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/admin/images/${image}${v ? `?v=${v}` : ""}`} alt="" className="h-20 w-14 shrink-0 rounded object-cover" loading="lazy" />
  ) : (
    <div className="h-20 w-14 shrink-0 rounded bg-sand-2" />
  );
}

/** Approve sends it live (pay link first). Correct lets me fix the name or price, then sends it live. */
export function LookRow({
  card,
}: {
  card: {
    id: string;
    name: string;
    label: string;
    image: string | null;
    price: number | null;
    suggested: number | null;
    source: string | null;
    status: string;
    note: string | null;
    rotation: boolean;
    v: number;
  };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(card.name);
  const [price, setPrice] = useState(card.price != null ? String(card.price) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go(body: Record<string, unknown>, el: Element | null) {
    setBusy(true);
    setErr("");
    try {
      const j = await patch(card.id, { ...body, confirm: true });
      if (j.wentLive) confetti(el);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <li className="card flex flex-wrap items-center gap-3 p-3">
      <Thumb image={card.image} v={card.v} />
      <div className="min-w-0 flex-1">
        <Link href={`/admin/review/${card.id}`} className="font-semibold hover:text-teal-2">
          {card.label || "Unnamed"}
        </Link>
        <div className="text-sm">
          <span className="text-lg font-bold">{money(card.price)}</span>
          <span className="text-navy/60"> · {card.source ?? "no source"}</span>
          {card.status === "Pulled" && <span className="chip ml-2 bg-navy/10 text-navy/60">pulled</span>}
        </div>
        {card.note && <p className="text-xs text-coral">{card.note}</p>}
        {card.rotation && (
          <div className="mt-1 flex gap-1">
            {([270, 90, 180] as const).map((d) => (
              <button
                key={d}
                type="button"
                data-nopop
                className="btn-ghost px-2 py-0.5 text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await fetch(`/api/admin/cards/${card.id}/rotate?deg=${d}`, { method: "POST" });
                  setBusy(false);
                  router.refresh();
                }}
              >
                {d === 270 ? "↺ 90°" : d === 90 ? "↻ 90°" : "180°"}
              </button>
            ))}
          </div>
        )}
        {editing && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              Name
              <input className="input mt-0.5 w-56" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="text-xs">
              Price ($)
              <input className="input mt-0.5 w-24" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          </div>
        )}
        {err && <p className="text-xs text-coral">{err}</p>}
      </div>
      <div className="flex gap-2">
        {editing ? (
          <>
            <button className="btn-ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={busy || !name.trim() || !(Number(price) > 0)}
              onClick={(e) => go({ ...(name.trim() !== card.name ? { name: name.trim() } : {}), manualPrice: Number(price) }, e.currentTarget)}
            >
              {busy ? "Saving…" : "Save + go live"}
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              Correct
            </button>
            <button className="btn-primary" disabled={busy || card.price == null} onClick={(e) => go({}, e.currentTarget)}>
              {busy ? "Going live…" : "Approve"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** One button off the shop: the pay link is expired and the card waits in Needs a look as Pulled. */
export function LiveRow({ card }: { card: { id: string; label: string; image: string | null; price: number | null; v?: number } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <li className="card flex items-center gap-3 p-2">
      <Thumb image={card.image} v={card.v} />
      <div className="min-w-0 flex-1">
        <Link href={`/card/${card.id}`} target="_blank" className="line-clamp-2 text-sm font-semibold hover:text-teal-2">
          {card.label}
        </Link>
        <div className="text-sm text-navy/70">{money(card.price)}</div>
        {err && <p className="text-xs text-coral">{err}</p>}
      </div>
      <button
        className="btn-ghost text-coral"
        disabled={busy}
        data-nopop
        onClick={async () => {
          setBusy(true);
          try {
            await patch(card.id, { status: "Pulled" });
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
      >
        {busy ? "Pulling…" : "Pull"}
      </button>
    </li>
  );
}
