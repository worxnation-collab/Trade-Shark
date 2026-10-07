"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { confetti, pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import type { ShipLine, ShipToFields } from "@/lib/game/ship";
import { ACCENT } from "@/lib/brandAssets";
import { CardGrid } from "../packs/[category]/CardGrid";

export interface StoredPack {
  id: string;
  category: string;
  product: string;
  number: number | null;
  at: string;
  how: string;
  state: "stored" | "shipping" | "shipped";
  tracking: string | null;
}

type Res = Record<string, unknown> & { ok: boolean; error?: string };
const call = async (path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: r.statusText }))) as Res;
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

type Ship = { k: "off" } | { k: "pick" } | { k: "address" } | { k: "quote"; line: ShipLine } | { k: "done"; shipping: number; packs: number; tracking: string | null };

export function Collection({ packs, order, address, pattern }: { packs: StoredPack[]; order: string[]; address: ShipToFields; pattern: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<PackView | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [ship, setShip] = useState<Ship>({ k: "off" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addr, setAddr] = useState<ShipToFields>(address);
  const stored = packs.filter((p) => p.state === "stored");
  const picking = ship.k === "pick";

  async function view(id: string) {
    setLoading(id);
    setError("");
    const r = await call(`/api/play/collection/${id}`);
    setLoading("");
    if (!r.ok) return setError(r.error ?? "Couldn't open that pack.");
    setOpen(r.pack as PackView);
    window.scrollTo({ top: 0 });
  }

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function quote() {
    setLoading("quote");
    setError("");
    const r = await call("/api/play/ship/quote", { packIds: [...picked], address: addr });
    setLoading("");
    if (!r.ok) return setError(r.error ?? "Couldn't price shipping.");
    if (r.address) setAddr(r.address as ShipToFields);
    setShip({ k: "quote", line: r.ship as ShipLine });
  }

  async function pay(line: ShipLine, el: HTMLElement) {
    setLoading("pay");
    setError("");
    const r = await call("/api/play/ship/buy", { quoteId: line.quoteId });
    setLoading("");
    if (!r.ok) {
      if (r.code === "ship-changed") setShip({ k: "address" });
      return setError(r.error ?? "That didn't go through.");
    }
    confetti(el);
    setPicked(new Set());
    setShip({ k: "done", shipping: r.shipping as number, packs: r.packs as number, tracking: (r.tracking as string | null) ?? null });
    router.refresh();
  }

  if (open)
    return (
      <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center text-center">
        <p className="text-2xl font-black uppercase tracking-tight text-navy">
          {packs.find((p) => p.id === open.id)?.product ?? "Pack"} {open.number ?? ""}
        </p>
        <p className="text-xs text-navy/60">12 cards · pack value {usd(open.value)} · drag a card to tilt it, tap to see it bigger</p>
        <CardGrid pack={open} light />
        <button className="btn-coral mt-6 px-7 py-3" onClick={() => setOpen(null)}>
          Exit
        </button>
      </div>
    );

  if (!packs.length)
    return (
      <p className="pattern-band mt-8 rounded-2xl p-10 text-center text-sm font-semibold text-navy/80" style={pattern ? { backgroundImage: `url(${pattern})` } : undefined}>
        <span className="inline-block rounded-lg border-2 border-navy bg-sand px-4 py-2">
          No packs yet. <Link href="/" className="underline">Pick a pack</Link> to play.
        </span>
      </p>
    );

  const groups = order.map((c) => ({ c, list: packs.filter((p) => p.category === c) })).filter((g) => g.list.length);
  const field = (k: keyof ShipToFields, label: string, cls = "") => (
    <label className={`flex flex-col text-left text-xs text-sand/70 ${cls}`}>
      {label}
      <input className="mt-1 rounded-lg bg-white px-3 py-2 text-sm text-navy" value={addr[k] ?? ""} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl">
      {error && <p className="mb-4 rounded bg-coral/15 px-3 py-2 text-center text-sm font-semibold text-navy">{error}</p>}
      {groups.map((g) => (
        <div key={g.c} className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: ACCENT[g.c] === "#FFD23F" ? "#0B1F3A" : ACCENT[g.c] }}>{g.list[0].product}s</h2>
          <ul className="mt-2 divide-y divide-navy/10 overflow-hidden rounded-2xl border-2 border-navy bg-white">
            {g.list.map((p) => {
              const can = picking && p.state === "stored";
              return (
                <li key={p.id}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sand disabled:opacity-60"
                    onClick={() => (picking ? can && toggle(p.id) : view(p.id))}
                    disabled={!!loading || (picking && !can)}
                  >
                    {picking && <span className={`flex h-5 w-5 items-center justify-center rounded border-2 ${picked.has(p.id) ? "border-navy bg-gold text-navy" : "border-navy/40"}`}>{picked.has(p.id) ? "✓" : ""}</span>}
                    <span className="flex-1">
                      <span className="block font-extrabold text-navy">
                        {p.product} {p.number ?? ""}
                      </span>
                      <span className="block text-xs text-navy/60">
                        {day(p.at)} · {p.how}
                      </span>
                    </span>
                    <span className="text-xs">
                      {p.state === "stored" ? (
                        <span className="font-semibold text-navy/70">{loading === p.id ? "Opening…" : "In collection"}</span>
                      ) : p.tracking ? (
                        <a href={p.tracking} target="_blank" rel="noreferrer" className="font-semibold text-teal-2 underline" onClick={(e) => e.stopPropagation()}>
                          {p.state === "shipped" ? "Shipped · track" : "Shipping · track"}
                        </a>
                      ) : (
                        <span className="font-semibold text-teal-2">Shipping soon</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="sticky bottom-3 z-10 mt-8 rounded-2xl bg-navy-2/95 p-4 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur">
        {ship.k === "off" && (
          <>
            <button className="btn-coral px-8 py-3 text-lg" disabled={!stored.length} onClick={() => (pop(), setShip({ k: "pick" }), setPicked(new Set(stored.map((p) => p.id))))}>
              Ship
            </button>
            <p className="mt-1 text-xs text-sand/60">{stored.length ? `${stored.length} pack${stored.length === 1 ? "" : "s"} waiting. Ship one or several in one parcel.` : "Nothing waiting to ship."}</p>
          </>
        )}
        {ship.k === "pick" && (
          <>
            <p className="text-sm text-white">Tick the packs to send together ({picked.size} picked).</p>
            <div className="mt-2 flex justify-center gap-3">
              <button className="btn-ghost px-5 py-2" onClick={() => setShip({ k: "off" })}>
                Cancel
              </button>
              <button className="btn-coral px-6 py-2" disabled={!picked.size} onClick={() => setShip({ k: "address" })}>
                Next
              </button>
            </div>
          </>
        )}
        {ship.k === "address" && (
          <>
            <p className="text-sm font-semibold text-white">Ship {picked.size} pack{picked.size === 1 ? "" : "s"} to:</p>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {field("name", "Name", "col-span-6")}
              {field("line1", "Street", "col-span-6")}
              {field("line2", "Apt / unit (optional)", "col-span-6")}
              {field("city", "City", "col-span-3")}
              {field("state", "State", "col-span-1")}
              {field("postal", "ZIP", "col-span-2")}
            </div>
            <div className="mt-3 flex justify-center gap-3">
              <button className="btn-ghost px-5 py-2" onClick={() => setShip({ k: "pick" })}>
                Back
              </button>
              <button className="btn-coral px-6 py-2" disabled={loading === "quote"} onClick={quote}>
                {loading === "quote" ? "Checking…" : "Confirm address"}
              </button>
            </div>
          </>
        )}
        {ship.k === "quote" && (
          <>
            <p className="text-sm text-white">
              {ship.line.packs} pack{ship.line.packs === 1 ? "" : "s"}, one parcel, to {addr.line1}, {addr.city} {addr.state}
            </p>
            <p className="mt-1 text-base font-semibold text-white">Shipping · {ship.line.label}</p>
            <div className="mt-3 flex justify-center gap-3">
              <button className="btn-ghost px-5 py-2" onClick={() => setShip({ k: "address" })}>
                Back
              </button>
              <button className="btn-coral px-6 py-2" disabled={loading === "pay"} onClick={(e) => pay(ship.line, e.currentTarget)} data-pop>
                {loading === "pay" ? "Paying…" : ship.line.amount ? `Pay ${usd(ship.line.amount)} and ship` : "Ship"}
              </button>
            </div>
          </>
        )}
        {ship.k === "done" && (
          <>
            <p className="text-base font-bold text-white">
              {ship.packs} pack{ship.packs === 1 ? "" : "s"} on the way{ship.shipping ? ` · ${usd(ship.shipping)} shipping charged` : ""}!
            </p>
            <p className="mt-1 text-xs text-sand/70">
              {ship.tracking ? (
                <a href={ship.tracking} target="_blank" rel="noreferrer" className="underline">
                  Track it
                </a>
              ) : (
                "Tracking comes by email once the label prints."
              )}
            </p>
            <button className="btn-ghost mt-2 px-5 py-2" onClick={() => setShip({ k: "off" })}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
