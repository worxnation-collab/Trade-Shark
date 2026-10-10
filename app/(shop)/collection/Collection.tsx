"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import type { ShipLine, ShipToFields } from "@/lib/game/ship";
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

/** A prize single in the vault. Ships with packs in one parcel, or sells back for store credit. */
export interface VaultSingle {
  id: string;
  name: string;
  condition: string;
  value: number;
  at: string;
  how: string;
  status: "in_vault" | "ship_requested" | "shipped" | "sold_back";
  tracking: string | null;
}

type Res = Record<string, unknown> & { ok: boolean; error?: string };
const call = async (path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: r.statusText }))) as Res;
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

type Ship = { k: "off" } | { k: "pick" } | { k: "address" } | { k: "quote"; line: ShipLine } | { k: "done"; shipping: number; items: string; tracking: string | null };

const items = (packs: number, singles: number) => {
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : "");
  return [part(packs, "pack"), part(singles, "single")].filter(Boolean).join(" and ");
};
const vaultState: Record<VaultSingle["status"], string> = { in_vault: "In vault", ship_requested: "Shipping soon", shipped: "Shipped", sold_back: "Sold back" };

export function Collection({
  packs,
  singles = [],
  credit = 0,
  sellBackPct = 80,
  order,
  address,
}: {
  packs: StoredPack[];
  singles?: VaultSingle[];
  credit?: number;
  sellBackPct?: number;
  order: string[];
  address: ShipToFields;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PackView | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [ship, setShip] = useState<Ship>({ k: "off" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedV, setPickedV] = useState<Set<string>>(new Set());
  const [selling, setSelling] = useState<string | null>(null);
  const [addr, setAddr] = useState<ShipToFields>(address);
  const stored = packs.filter((p) => p.state === "stored");
  const inVault = singles.filter((v) => v.status === "in_vault");
  const waiting = stored.length + inVault.length;
  const pickedN = picked.size + pickedV.size;
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

  function toggleV(id: string) {
    setPickedV((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function sellBack(id: string) {
    setLoading(`sell:${id}`);
    setError("");
    const r = await call(`/api/play/vault/${id}/sell-back`, {});
    setLoading("");
    setSelling(null);
    if (!r.ok) return setError(r.error ?? "Couldn't sell that back.");
    router.refresh();
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
    const r = await call("/api/play/ship/quote", { packIds: [...picked], vaultIds: [...pickedV], address: addr });
    setLoading("");
    if (!r.ok) return setError(r.error ?? "Couldn't price shipping.");
    if (r.address) setAddr(r.address as ShipToFields);
    setShip({ k: "quote", line: r.ship as ShipLine });
  }

  async function pay(line: ShipLine) {
    setLoading("pay");
    setError("");
    const r = await call("/api/play/ship/buy", { quoteId: line.quoteId });
    setLoading("");
    if (!r.ok) {
      if (r.code === "ship-changed") setShip({ k: "address" });
      return setError(r.error ?? "That didn't go through.");
    }
    setPicked(new Set());
    setPickedV(new Set());
    setShip({ k: "done", shipping: r.shipping as number, items: items(r.packs as number, (r.singles as number) ?? 0), tracking: (r.tracking as string | null) ?? null });
    router.refresh();
  }

  if (open)
    return (
      <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center text-center">
        <p className="font-display text-2xl tracking-tight text-navy">
          {packs.find((p) => p.id === open.id)?.product ?? "Pack"} {open.number ?? ""}
        </p>
        <p className="text-xs text-navy/60">12 cards · drag a card to tilt it, tap to see it bigger</p>
        <CardGrid pack={open} />
        <button className="btn-reveal mt-6 px-7 py-3" onClick={() => setOpen(null)}>
          Exit
        </button>
      </div>
    );

  if (!packs.length && !singles.length)
    return (
      <p className="mt-8 rounded-lg border border-navy/15 bg-white p-10 text-center text-base text-navy/80">
        No packs yet. <Link href="/packs/pokemon" className="underline">Roll a pack</Link> to play.
      </p>
    );

  const groups = order.map((c) => ({ c, list: packs.filter((p) => p.category === c) })).filter((g) => g.list.length);
  const field = (k: keyof ShipToFields, label: string, cls = "") => (
    <label className={`flex flex-col text-left text-xs text-navy/70 ${cls}`}>
      {label}
      <input className="mt-1 rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy" value={addr[k] ?? ""} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl">
      {error && (
        <p className="mb-4 rounded border border-navy/20 bg-white px-3 py-2 text-center text-sm font-semibold text-navy">
          {error}
          {error === "Save a card first." && (
            <>
              {" "}
              <Link href="/play/card" className="underline">
                Save one
              </Link>
            </>
          )}
        </p>
      )}
      {singles.length > 0 && (
        <div className="mt-6">
          <h2 className="font-display text-sm text-navy">
            Vault{credit > 0 && <span className="ml-2 font-sans text-xs font-semibold text-navy/70">Store credit {usd(credit)}</span>}
          </h2>
          <ul className="mt-2 divide-y divide-navy/10 overflow-hidden rounded-2xl border-2 border-navy bg-white">
            {singles.map((v) => {
              const can = picking && v.status === "in_vault";
              const live = v.status === "in_vault" || v.status === "ship_requested" || v.status === "shipped";
              return (
                <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                  {picking && (
                    <button
                      aria-label={`Ship ${v.name}`}
                      disabled={!can}
                      onClick={() => toggleV(v.id)}
                      className={`flex h-5 w-5 items-center justify-center rounded border-2 disabled:opacity-40 ${pickedV.has(v.id) ? "border-navy bg-navy text-sand" : "border-navy/40"}`}
                    >
                      {pickedV.has(v.id) ? "✓" : ""}
                    </button>
                  )}
                  {live ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/play/vault/${v.id}/image`} alt={v.name} className="h-16 w-12 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="h-16 w-12 rounded bg-sand" aria-hidden />
                  )}
                  <span className="flex-1">
                    <span className="block font-extrabold text-navy">{v.name}</span>
                    <span className="block text-xs text-navy/60">
                      {day(v.at)} · {v.how} · {v.condition} · {usd(v.value)}
                    </span>
                    {selling === v.id && (
                      <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-navy">
                        Sell back for {usd(Math.round(v.value * sellBackPct) / 100)} store credit?
                        <button className="btn-ghost px-3 py-1" onClick={() => setSelling(null)}>
                          Keep it
                        </button>
                        <button className="btn-reveal px-3 py-1" disabled={loading === `sell:${v.id}`} onClick={() => sellBack(v.id)}>
                          {loading === `sell:${v.id}` ? "Selling…" : "Sell back"}
                        </button>
                      </span>
                    )}
                  </span>
                  <span className="text-right text-xs">
                    {v.tracking && v.status !== "in_vault" ? (
                      <a href={v.tracking} target="_blank" rel="noreferrer" className="font-semibold text-navy underline">
                        {vaultState[v.status]} · track
                      </a>
                    ) : (
                      <span className="block font-semibold text-navy/70">{vaultState[v.status]}</span>
                    )}
                    {v.status === "in_vault" && !picking && selling !== v.id && (
                      <button className="mt-1 block text-navy underline" disabled={!!loading} onClick={() => setSelling(v.id)}>
                        Sell back
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-navy/60">Prizes wait here. Ship them with your packs, or sell one back for {sellBackPct}% of its value in store credit.</p>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.c} className="mt-6">
          <h2 className="font-display text-sm text-navy">{g.list[0].product}s</h2>
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
                    {picking && <span className={`flex h-5 w-5 items-center justify-center rounded border-2 ${picked.has(p.id) ? "border-navy bg-navy text-sand" : "border-navy/40"}`}>{picked.has(p.id) ? "✓" : ""}</span>}
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
                        <a href={p.tracking} target="_blank" rel="noreferrer" className="font-semibold text-navy underline" onClick={(e) => e.stopPropagation()}>
                          {p.state === "shipped" ? "Shipped · track" : "Shipping · track"}
                        </a>
                      ) : (
                        <span className="font-semibold text-navy">Shipping soon</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="sticky bottom-3 z-10 mt-8 rounded-lg border border-navy/15 border-b-gold bg-sand p-4 text-center">
        {ship.k === "off" && (
          <>
            <button
              className="btn-reveal px-8 py-3 text-lg"
              disabled={!waiting}
              onClick={() => (pop(), setShip({ k: "pick" }), setPicked(new Set(stored.map((p) => p.id))), setPickedV(new Set(inVault.map((v) => v.id))))}
            >
              Ship
            </button>
            <p className="mt-1 text-xs text-navy/60">{waiting ? `${items(stored.length, inVault.length)} waiting. Ship one or several in one parcel.` : "Nothing waiting to ship."}</p>
          </>
        )}
        {ship.k === "pick" && (
          <>
            <p className="text-sm text-navy">Tick what to send together ({pickedN} picked).</p>
            <div className="mt-2 flex justify-center gap-3">
              <button className="btn-ghost px-5 py-2" onClick={() => setShip({ k: "off" })}>
                Cancel
              </button>
              <button className="btn-reveal px-6 py-2" disabled={!pickedN} onClick={() => setShip({ k: "address" })}>
                Next
              </button>
            </div>
          </>
        )}
        {ship.k === "address" && (
          <>
            <p className="text-sm font-semibold text-navy">Ship {items(picked.size, pickedV.size)} to:</p>
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
              <button className="btn-reveal px-6 py-2" disabled={loading === "quote"} onClick={quote}>
                {loading === "quote" ? "Checking…" : "Confirm address"}
              </button>
            </div>
          </>
        )}
        {ship.k === "quote" && (
          <>
            <p className="text-sm text-navy">
              {items(ship.line.packs, ship.line.singles)}, one parcel, to {addr.line1}, {addr.city} {addr.state}
            </p>
            <p className="mt-1 text-base font-semibold text-navy">Shipping · {ship.line.label}</p>
            <div className="mt-3 flex justify-center gap-3">
              <button className="btn-ghost px-5 py-2" onClick={() => setShip({ k: "address" })}>
                Back
              </button>
              <button className="btn-reveal px-6 py-2" disabled={loading === "pay"} onClick={() => pay(ship.line)} data-pop>
                {loading === "pay" ? "Paying…" : ship.line.amount ? `Pay ${usd(ship.line.amount)} and ship` : "Ship"}
              </button>
            </div>
          </>
        )}
        {ship.k === "done" && (
          <>
            <p className="text-base font-bold text-navy">
              {ship.items} on the way{ship.shipping ? ` · ${usd(ship.shipping)} shipping charged` : ""}!
            </p>
            <p className="mt-1 text-xs text-navy/70">
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
