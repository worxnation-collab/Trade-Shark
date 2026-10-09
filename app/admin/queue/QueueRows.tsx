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
  return j as { packed?: boolean };
}

/** The scan is the large object in a fix row. */
function Scan({ image, v }: { image: string | null; v?: number }) {
  // ?v= busts the browser cache after a card is turned.
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/admin/images/${image}${v ? `?v=${v}` : ""}`} alt="" className="aspect-[5/7] w-36 shrink-0 rounded object-contain sm:w-48" loading="lazy" />
  ) : (
    <div className="aspect-[5/7] w-36 shrink-0 rounded bg-sand-2 sm:w-48" />
  );
}

/** Approve puts it in stock for its category's next pack. Correct lets me fix the name or price first. */
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
      if (j.packed) confetti(el);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <li className="card flex items-start gap-4 p-3">
      <Scan image={card.image} v={card.v} />
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={`/admin/review/${card.id}`} className="font-semibold hover:underline">
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
        <div className="flex flex-wrap gap-2 pt-2">
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
                {busy ? "Saving…" : "Save + approve"}
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
                Correct
              </button>
              <button className="btn-primary" disabled={busy || card.price == null} onClick={(e) => go({}, e.currentTarget)}>
                {busy ? "Approving…" : "Approve"}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
