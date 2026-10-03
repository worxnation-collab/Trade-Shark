"use client";

import type { Card, SourceRun } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfidenceChip, PileChip, StatusChip } from "@/components/StatusChip";
import { netAfterFees, sourceName, type QuoteRow, type Suggestion } from "@/lib/pricing/engine";
import type { Settings } from "@/lib/settings";
import { CONDITIONS, GAMES, SHIPPING_PROFILES, STATUS_LABEL, STATUSES, type IdentCandidate, type IdentField, type ShippingProfile } from "@/lib/types";
import { confetti } from "@/lib/client/feel";
import { money } from "@/lib/util";

type J<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
type Quote = J<QuoteRow> & { id: string };

interface Props {
  card: J<Card>;
  settings: Settings;
  alternates: IdentCandidate[];
  seeds: IdentCandidate[];
  fieldConfidence: Partial<Record<IdentField, number>>;
  latest: Quote[];
  historyCount: number;
  suggestion: Suggestion & { soldStats: (Suggestion["soldStats"] & { last5: Quote[] }) | null };
  runs: J<SourceRun>[];
  dupOf: { id: string; name: string | null; setName: string | null; number: string | null; status: string; frontImage: string | null; batch: { name: string } } | null;
  prevId: string | null;
  nextId: string | null;
  qs: string;
  defaultTitle: string;
  defaultDescription: string;
  featured: boolean;
}

const FIELDS: { k: keyof Form; label: string; conf?: IdentField; wide?: boolean }[] = [
  { k: "name", label: "Name", conf: "name", wide: true },
  { k: "setName", label: "Set", conf: "setName" },
  { k: "setCode", label: "Set code", conf: "setCode" },
  { k: "number", label: "Number", conf: "number" },
  { k: "year", label: "Year", conf: "year" },
  { k: "variant", label: "Variant", conf: "variant" },
  { k: "rarity", label: "Rarity", conf: "rarity" },
];
const SPORTS: typeof FIELDS = [
  { k: "player", label: "Player", conf: "player" },
  { k: "team", label: "Team", conf: "team" },
];

interface Form {
  game: string;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  year: string;
  variant: string;
  rarity: string;
  player: string;
  team: string;
  condition: string;
  graded: string;
  quantity: string;
  cost: string;
  manualPrice: string;
  shippingProfile: string;
  title: string;
  description: string;
  notes: string;
  status: string;
  listedUrl: string;
  listedChannel: string;
  soldPrice: string;
  soldChannel: string;
}

const str = (v: unknown) => (v == null ? "" : String(v));

function KindTag({ kind }: { kind: string }) {
  const map: Record<string, [string, string]> = {
    sold_comp: ["sold comp", "bg-teal/15 text-teal-2"],
    market: ["market", "bg-navy/10 text-navy"],
    retail_ask: ["retail ask — not sold", "bg-sand-2 text-navy/70"],
    manual: ["Manual", "bg-coral text-white"],
  };
  const [t, c] = map[kind] ?? [kind, "bg-navy/10"];
  return <span className={`chip ${c}`}>{t}</span>;
}

export function ReviewScreen(p: Props) {
  const router = useRouter();
  const c = p.card;
  const s = p.settings;
  const initial: Form = {
    game: c.game, name: str(c.name), setName: str(c.setName), setCode: str(c.setCode), number: str(c.number), year: str(c.year),
    variant: str(c.variant), rarity: str(c.rarity), player: str(c.player), team: str(c.team), condition: c.condition, graded: str(c.graded),
    quantity: str(c.quantity), cost: str(c.cost), manualPrice: str(c.manualPrice), shippingProfile: c.shippingProfile,
    title: str(c.title), description: str(c.description), notes: str(c.notes), status: c.status, listedUrl: str(c.listedUrl),
    listedChannel: str(c.listedChannel), soldPrice: str(c.soldPrice), soldChannel: str(c.soldChannel),
  };
  const [f, setF] = useState<Form>(initial);
  const [alt, setAlt] = useState<IdentCandidate | null>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [comps, setComps] = useState(str(c.pastedComps));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLDivElement>(null);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  const set = (k: keyof Form, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setTouched((t) => new Set(t).add(k));
  };
  const confirmed = !!c.confirmedAt;
  const uncertain = (conf?: IdentField, k?: keyof Form) => {
    if (confirmed || alt || !conf || (k && touched.has(k))) return false;
    const v = p.fieldConfidence[conf];
    if (k === "name" && !f.name) return true;
    return v != null && v < s.confidenceThreshold;
  };

  const go = useCallback((id: string | null) => {
    if (id) router.push(`/admin/review/${id}${p.qs}`);
    else router.push(p.qs.includes("batch=") ? `/admin/batches/${new URLSearchParams(p.qs.slice(1)).get("batch")}` : `/admin/cards${p.qs}`);
  }, [router, p.qs]);

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setErr("");
    try {
      const res = await fetch(`/api/admin/cards/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      return j;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy("");
    }
  }

  const save = useCallback(async (andNext: boolean) => {
    const body: Record<string, unknown> = { ...f, confirm: true };
    // Only send status if I changed it; otherwise the server decides Ready / Bulk Hold from the price.
    if (f.status === c.status) delete body.status;
    if (alt) body.alternate = { source: alt.source, catalogId: alt.catalogId, catalogImage: alt.catalogImage, tcgplayerId: alt.tcgplayerId, tcgplayerUrl: alt.tcgplayerUrl };
    if (!f.title) body.title = "";
    const ok = await patch(body, "Saving");
    if (!ok) {
      // e.g. Stripe refused the pay link: the card stayed Priced. Show the server's truth.
      router.refresh();
      return;
    }
    // Celebrate going live or a sale, never block on it.
    if (ok.wentLive || ok.sold) confetti(saveBtn.current);
    if (andNext && p.nextId) go(p.nextId);
    else router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, alt, c.status, p.nextId, go, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && t?.tagName !== "TEXTAREA" && t?.tagName !== "BUTTON") {
        e.preventDefault();
        if (!busy) save(true);
        return;
      }
      if (e.key === "Escape" && typing) (t as HTMLElement).blur();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "J") go(p.nextId);
      else if (e.key === "k" || e.key === "K") p.prevId && go(p.prevId);
      else if (e.key === "f" || e.key === "F") setSide((x) => (x === "front" ? "back" : "front"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, save, go, p.nextId, p.prevId]);

  function useAlternate(a: IdentCandidate) {
    setAlt(a);
    setF((x) => ({
      ...x,
      game: a.fields.game ?? x.game,
      name: a.fields.name ?? x.name,
      setName: a.fields.setName ?? x.setName,
      setCode: a.fields.setCode ?? x.setCode,
      number: a.fields.number ?? x.number,
      year: a.fields.year ?? x.year,
      variant: a.fields.variant ?? x.variant,
      rarity: a.fields.rarity ?? x.rarity,
      player: a.fields.player ?? x.player,
      team: a.fields.team ?? x.team,
    }));
  }

  async function action(url: string, label: string) {
    setBusy(label);
    setErr("");
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? res.statusText);
    setBusy("");
    router.refresh();
  }

  const price = f.manualPrice !== "" ? Number(f.manualPrice) : c.suggestedPrice;
  const winner: IdentCandidate = {
    source: c.identSource ?? "—",
    confidence: c.sourceConfidence,
    fields: {},
    catalogImage: c.catalogImage ?? undefined,
  };
  const groups = new Map<string, Quote[]>();
  for (const q of p.latest) groups.set(q.source, [...(groups.get(q.source) ?? []), q]);
  const sold = p.suggestion.soldStats;

  const img = side === "back" && c.backImage ? c.backImage : c.frontImage;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)] lg:grid-cols-2">
      {/* Images */}
      <div className="space-y-2">
        <div className="card relative flex items-center justify-center overflow-hidden bg-navy/5 p-2" style={{ minHeight: 420 }}>
          {img && c.readable ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/admin/images/${img}?v=${encodeURIComponent(String(c.updatedAt))}`} alt={side} className="max-h-[72vh] w-auto object-contain" />
          ) : (
            <div className="p-10 text-center text-sm text-navy/60">
              <div className="font-semibold text-coral">Unreadable file</div>
              <div className="mt-1 font-mono text-xs">{c.frontOrigName}</div>
              <p className="mt-2">Re-export it as JPEG/PNG and upload again, or archive it.</p>
            </div>
          )}
          <span className="absolute left-2 top-2 chip bg-navy text-white">{side}</span>
        </div>
        <div className="flex items-start gap-2">
          {c.backImage && c.readable && (
            <button onClick={() => setSide(side === "front" ? "back" : "front")} className="card overflow-hidden p-1" title="Flip (F)">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/admin/images/${side === "front" ? c.backImage : c.frontImage}`} alt="other side" className="h-28 w-20 object-cover" />
            </button>
          )}
          {(alt?.catalogImage || c.catalogImage) && (
            <div className="card p-1 text-center" title="Catalog image for comparison">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={alt?.catalogImage || c.catalogImage!} alt="catalog" className="h-28 w-20 object-contain" />
              <div className="text-[10px] text-navy/50">catalog</div>
            </div>
          )}
          <div className="flex-1 space-y-0.5 text-[11px] text-navy/60">
            <div><b>Pair</b> {c.pairId}</div>
            <div className="break-all"><b>Front</b> {c.frontOrigName ?? "—"}</div>
            <div className="break-all"><b>Back</b> {c.backOrigName ?? "—"}</div>
            <div className="break-all font-mono"><b className="font-sans">Hash</b> {c.frontHash?.slice(0, 16)}…</div>
            {c.sheetInfo &&
              (() => {
                const si = JSON.parse(c.sheetInfo) as Record<string, { sheet: string; rel?: string; index?: number } | null>;
                return (["front", "back"] as const).map((k) =>
                  si[k] ? (
                    <div key={k} className="break-all">
                      <b>Flatbed {k}</b> crop {si[k]!.index} of{" "}
                      {si[k]!.rel ? (
                        <a className="underline" href={`/api/admin/images/${si[k]!.rel}`} target="_blank" rel="noreferrer">
                          {si[k]!.sheet}
                        </a>
                      ) : (
                        si[k]!.sheet
                      )}
                    </div>
                  ) : null,
                );
              })()}
            <div className="flex flex-wrap gap-1 pt-1">
              <StatusChip status={c.status} />
              <PileChip pile={c.pile} />
              <ConfidenceChip value={c.sourceConfidence} threshold={s.confidenceThreshold} confirmed={confirmed} />
              <button
                type="button"
                data-nopop
                className={`chip ${p.featured ? "bg-coral text-white" : "bg-navy/5 text-navy/70 hover:bg-navy/10"}`}
                title="Pin to the home hero (beats the wow score)"
                onClick={() => action(`/api/admin/cards/${c.id}/feature?on=${p.featured ? 0 : 1}`, "Pinning")}
              >
                {p.featured ? "★ Featured on home" : "☆ Feature on home"}
              </button>
              {c.wowScore > 0 && <span className="chip bg-teal/15 text-teal-2" title={c.wowTags}>wow {c.wowScore}</span>}
            </div>
          </div>
        </div>
        {p.dupOf && (
          <div className="card flex items-center gap-3 border-coral p-2 text-sm">
            {p.dupOf.frontImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/admin/images/${p.dupOf.frontImage}`} alt="" className="h-16 w-12 rounded object-cover" />
            )}
            <div className="flex-1">
              <div className="font-semibold text-coral">Possible duplicate</div>
              <a href={`/admin/review/${p.dupOf.id}`} className="underline">{p.dupOf.name ?? "card"} {p.dupOf.number}</a> · {p.dupOf.batch.name} · {STATUS_LABEL[p.dupOf.status as keyof typeof STATUS_LABEL]}
            </div>
            <button className="btn-ghost text-xs" onClick={() => patch({ pile: "none" }, "…").then(() => router.refresh())}>Not a dupe</button>
          </div>
        )}
        {c.pile !== "none" && c.pile !== "duplicate" && (
          <button className="btn-ghost text-xs" onClick={() => patch({ pile: "none" }, "…").then(() => router.refresh())}>Move out of review pile</button>
        )}
      </div>

      {/* Form */}
      <div ref={formRef} className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Identity</h2>
          <button className="text-xs font-semibold text-teal" disabled={!!busy} onClick={() => action(`/api/admin/cards/${c.id}/reidentify`, "Re-identifying")}>
            ↻ Re-identify
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Game</label>
            <select className={`input ${uncertain("game") ? "input-uncertain" : ""}`} value={f.game} onChange={(e) => set("game", e.target.value)}>
              {GAMES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          {[...FIELDS, ...(f.game === "Sports" ? SPORTS : [])].map(({ k, label, conf, wide }) => (
            <div key={k} className={wide ? "col-span-2" : ""}>
              <label className="label">
                {label}
                {conf && p.fieldConfidence[conf] != null && !confirmed && (
                  <span className={`ml-1 normal-case ${uncertain(conf, k) ? "text-coral" : "text-navy/40"}`}>{Math.round(p.fieldConfidence[conf]! * 100)}%</span>
                )}
              </label>
              <input className={`input ${uncertain(conf, k) ? "input-uncertain" : ""}`} value={f[k]} onChange={(e) => set(k, e.target.value)} autoFocus={k === "name"} />
            </div>
          ))}
          <div>
            <label className="label">Condition</label>
            <select className="input" value={f.condition} onChange={(e) => set("condition", e.target.value)}>
              {CONDITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Graded</label>
            <input className="input" value={f.graded} placeholder="e.g. PSA 10" onChange={(e) => set("graded", e.target.value)} />
          </div>
          <div>
            <label className="label">Qty</label>
            <input className="input" type="number" min={1} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
          </div>
          <div>
            <label className="label">Cost</label>
            <input className="input" inputMode="decimal" value={f.cost} onChange={(e) => set("cost", e.target.value)} />
          </div>
        </div>

        <div className="rounded-md bg-sand/70 p-2 text-xs">
          <div className="mb-1 font-semibold">
            Winner: {alt ? <span className="text-coral">{alt.source} (pending save)</span> : winner.source} · {Math.round((alt?.confidence ?? winner.confidence) * 100)}%
            {c.identConflict && <span className="ml-1 chip bg-coral/15 text-coral">sources disagree</span>}
          </div>
          {[...p.alternates, ...p.seeds.filter((sd) => !p.alternates.some((a) => a.source === sd.source))].slice(0, 8).map((a, i) => (
            <div key={i} className="flex items-center gap-2 border-t border-navy/5 py-1">
              {a.catalogImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.catalogImage} alt="" className="h-10 w-7 object-contain" />
              ) : (
                <div className="h-10 w-7" />
              )}
              <div className="flex-1">
                <div className="font-semibold">{[a.fields.name || a.fields.player, a.fields.setName, a.fields.number && `#${a.fields.number}`, a.fields.year].filter(Boolean).join(" · ") || "—"}</div>
                <div className="text-navy/50">{a.source} · {Math.round(a.confidence * 100)}%{a.note ? ` · ${a.note}` : ""}</div>
              </div>
              <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => useAlternate(a)}>Use</button>
            </div>
          ))}
          {!p.alternates.length && !p.seeds.length && <div className="text-navy/50">No alternates.</div>}
        </div>

        <h2 className="pt-1 font-bold">Listing</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="label">Title <span className="normal-case text-navy/40">(blank = template · {(f.title || p.defaultTitle).length}/80)</span></label>
            <input className="input" value={f.title} placeholder={p.defaultTitle} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Description <span className="normal-case text-navy/40">(blank = template)</span></label>
            <textarea className="input h-24 text-xs" value={f.description} placeholder={p.defaultDescription} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ship as</label>
            <select className="input" value={f.shippingProfile} onChange={(e) => set("shippingProfile", e.target.value)}>
              {SHIPPING_PROFILES.map((x) => <option key={x} value={x}>{x === "bubble" ? "bubble mailer" : x}</option>)}
            </select>
          </div>
          <div className="col-span-2 rounded-md border border-teal/30 bg-teal/5 p-2">
            <label className="label">Stripe pay link</label>
            {c.paymentLinkUrl && c.paymentLinkActive ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input readOnly className="input font-mono text-xs" value={c.paymentLinkUrl} onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    className="btn-dark shrink-0"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(c.paymentLinkUrl!);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {
                        setErr("Couldn't copy; select the link and copy it.");
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-navy/60">
                  <span>
                    {money(c.paymentLinkAmount)} · created {c.paymentLinkCreatedAt ? new Date(c.paymentLinkCreatedAt).toLocaleString() : ""}
                  </span>
                  <a href={c.paymentLinkUrl} target="_blank" rel="noreferrer" className="font-semibold text-teal underline">Open</a>
                  <button
                    type="button"
                    className="font-semibold text-coral underline"
                    disabled={!!busy}
                    onClick={() => confirm("Expire this link and create a new one at the current list price?") && action(`/api/admin/cards/${c.id}/paylink`, "Regenerating link")}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-navy/60">
                {c.paymentLinkUrl ? "Link expired (sold, archived, or pulled from sale). " : ""}A buy link is created automatically when you save this card as Ready.
              </p>
            )}
          </div>
          <div className="col-span-2">
            <label className="label">Live listing URL (paste after you publish)</label>
            <div className="flex gap-2">
              <select className="input w-32" value={f.listedChannel} onChange={(e) => set("listedChannel", e.target.value)}>
                <option value="">channel</option>
                <option value="ebay">eBay</option>
                <option value="tcgplayer">TCGplayer</option>
                <option value="local">Local</option>
              </select>
              <input className="input" value={f.listedUrl} placeholder="https://www.ebay.com/itm/…" onChange={(e) => set("listedUrl", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Sold price</label>
            <input className="input" inputMode="decimal" value={f.soldPrice} onChange={(e) => set("soldPrice", e.target.value)} />
          </div>
          <div>
            <label className="label">Sold on</label>
            <select className="input" value={f.soldChannel} onChange={(e) => set("soldChannel", e.target.value)}>
              <option value="">—</option>
              <option value="ebay">eBay</option>
              <option value="tcgplayer">TCGplayer</option>
              <option value="stripe">Stripe (pay link)</option>
              <option value="local">Local</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Notes</label>
            <input className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        {err && <p className="rounded bg-coral/10 p-2 text-sm text-coral">{err}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button ref={saveBtn} className="btn-primary flex-1 justify-center py-2" disabled={!!busy} onClick={() => save(true)}>
            {busy || "Save + next"} <kbd className="bg-teal-2 text-white">Enter</kbd>
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => save(false)}>Save</button>
          <button className="btn-ghost" disabled={!p.prevId} onClick={() => go(p.prevId)}>K</button>
          <button className="btn-ghost" onClick={() => go(p.nextId)}>J</button>
        </div>
        <p className="text-[11px] text-navy/50">
          Saving approves this card: $1 and up goes live on the shop with its pay link (if Stripe fails it waits in Needs a look); under $1 joins a
          Lil&apos; Stack. eBay/TCGplayer listings still only go up when you export and publish them yourself.
        </p>
      </div>

      {/* Price panel */}
      <div className="card space-y-3 p-4 lg:col-span-2 xl:col-span-1">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Price panel</h2>
          <button className="text-xs font-semibold text-teal" disabled={!!busy} onClick={() => action(`/api/admin/cards/${c.id}/reprice`, "Repricing")}>
            ↻ Refresh all sources
          </button>
        </div>
        <div className="rounded-md bg-navy p-3 text-sand">
          <div className="text-xs uppercase tracking-wide text-sand/60">{f.manualPrice !== "" ? "Manual" : "Suggested"}</div>
          <div className="text-3xl font-extrabold">{money(price)}</div>
          <div className="text-xs text-sand/70">
            {f.manualPrice !== "" ? "Manual override wins" : p.suggestion.basisLabel}
            {p.suggestion.multiplier !== 1 && f.manualPrice === "" && ` × ${p.suggestion.multiplier} (${c.condition})`}
            {c.pricedAt && ` · ${new Date(c.pricedAt).toLocaleString()}`}
          </div>
          {price != null && price < 1 && <div className="mt-1 text-xs font-semibold text-teal-2">Under $1 → Lil&apos; Stack</div>}
          {price != null && price > 5 && <div className="mt-1 text-xs font-semibold text-coral">Over $5 → only goes live when you approve it</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Manual price</label>
            <input className="input" inputMode="decimal" value={f.manualPrice} placeholder="override" onChange={(e) => set("manualPrice", e.target.value)} />
          </div>
          <div className="text-xs">
            <label className="label">Net after fees</label>
            {price != null ? (
              <table className="w-full">
                <tbody>
                  {(["ebay", "tcgplayer", "stripe", "local"] as const).map((ch) => {
                    const n = netAfterFees(price, ch, f.shippingProfile as ShippingProfile, s);
                    return (
                      <tr key={ch}>
                        <td className="pr-1 text-navy/60">{ch}</td>
                        <td className="text-right font-semibold">{money(n.net)}</td>
                        <td className="pl-1 text-right text-navy/40">−{money(n.fees + n.ship)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <span className="text-navy/50">no price</span>
            )}
          </div>
        </div>
        {p.suggestion.notes.length > 0 && (
          <ul className="space-y-0.5 text-xs text-coral">
            {p.suggestion.notes.map((n) => <li key={n}>• {n}</li>)}
          </ul>
        )}
        {p.suggestion.headlines.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs">
            {p.suggestion.headlines.map((h) => (
              <span key={h.label} className="chip bg-sand-2 text-navy">{h.label}: {money(h.amount)}</span>
            ))}
          </div>
        )}

        {sold && (
          <div className="rounded-md border border-teal/30 p-2 text-xs">
            <div className="mb-1 font-semibold">Sold comps: median {money(sold.median)} · low {money(sold.low)} · high {money(sold.high)} · n={sold.n}</div>
            <ol className="space-y-0.5">
              {sold.last5.map((q) => (
                <li key={q.id} className="flex justify-between gap-2">
                  <span className="truncate">{q.url ? <a href={q.url} target="_blank" rel="noreferrer" className="underline">{q.rawTitle}</a> : q.rawTitle}</span>
                  <span className="shrink-0 font-semibold">{money(q.amount)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="max-h-80 space-y-2 overflow-auto">
          {[...groups.entries()].map(([src, qs]) => (
            <div key={src} className="rounded-md border border-navy/10 p-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">{sourceName(src)}</span>
                <span className="flex items-center gap-1">
                  <KindTag kind={qs[0].kind} />
                  <span className="text-navy/40">{new Date(qs[0].fetchedAt).toLocaleString()}</span>
                </span>
              </div>
              {qs.slice(0, 12).map((q) => (
                <div key={q.id} className={`flex justify-between gap-2 ${q.excluded ? "text-navy/35 line-through" : ""}`} title={q.excludeReason ?? ""}>
                  <span className="truncate">
                    {q.label && q.label !== "comp" ? <b className="mr-1">{q.label}</b> : null}
                    {q.rawTitle}
                    {q.excluded && <span className="ml-1 no-underline">({q.excludeReason})</span>}
                  </span>
                  <span className="shrink-0">{q.currency === "USD" ? money(q.amount) : `${q.amount.toFixed(2)} ${q.currency}`}</span>
                </div>
              ))}
              {qs.length > 12 && <div className="text-navy/40">+{qs.length - 12} more</div>}
            </div>
          ))}
          {!groups.size && <div className="text-xs text-navy/50">No quotes yet.</div>}
          {p.historyCount > 0 && <div className="text-[11px] text-navy/40">{p.historyCount} older quote(s) kept as history.</div>}
        </div>

        <div>
          <label className="label">Paste sold comps (eBay sold page, any “title … $price” list)</label>
          <textarea className="input h-24 font-mono text-[11px]" value={comps} onChange={(e) => setComps(e.target.value)} placeholder={"Charizard 4/102 Base Holo\n$420.00\nSold Sep 20, 2026"} />
          <button className="btn-ghost mt-1 text-xs" disabled={!!busy} onClick={() => patch({ pastedComps: comps }, "Parsing").then(() => router.refresh())}>
            Parse comps
          </button>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-navy/60">Source log ({p.runs.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {p.runs.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span className={`w-14 shrink-0 font-semibold ${r.status === "ok" ? "text-teal-2" : r.status === "error" ? "text-coral" : "text-navy/40"}`}>{r.status}</span>
                <span className="w-28 shrink-0">{r.source}</span>
                <span className="flex-1 text-navy/60">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
