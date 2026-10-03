"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Settings } from "@/lib/settings";
import { CONDITIONS, SHIPPING_PROFILES } from "@/lib/types";

// Defined outside the form so inputs keep focus while typing.
function N({ label, value, onChange, step = "0.01", hint }: { label: string; value: number; onChange: (n: number) => void; step?: string; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" step={step} value={value} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
      {hint && <p className="mt-0.5 text-[11px] text-navy/50">{hint}</p>}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [msg, setMsg] = useState("");
  const num = (v: string) => (v === "" ? 0 : Number(v));

  async function save(extra: Record<string, unknown> = {}) {
    setMsg("Saving…");
    const res = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, recompute: true, ...extra }) });
    const j = await res.json();
    if (!res.ok) return setMsg(j.error ?? "Failed");
    setS(j);
    setMsg("Saved. Suggested prices recomputed from stored quotes.");
    // New shipping rates have to reach the live pay links (old links are expired and replaced).
    const before = initial.buyerShipping;
    if (before.pwe !== j.buyerShipping.pwe || before.bubble !== j.buyerShipping.bubble || before.freeAt !== j.buyerShipping.freeAt) {
      let total = 0;
      for (let i = 0; i < 100; i++) {
        setMsg(`Saved. Updating pay links to the new shipping… ${total} done`);
        const r = await fetch("/api/admin/paylinks/refresh", { method: "POST" });
        const k = await r.json().catch(() => ({ remaining: 0, done: 0, errors: ["refresh failed"] }));
        total += k.done ?? 0;
        if (k.errors?.length) {
          setMsg(`Saved. ${total} pay links updated; problems: ${k.errors.join("; ")}`);
          break;
        }
        if (!k.remaining || !k.done) {
          setMsg(`Saved. ${total} pay link${total === 1 ? "" : "s"} updated to the new shipping.`);
          break;
        }
      }
    }
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Shipping the buyer pays</h2>
        <div className="grid grid-cols-3 gap-2">
          <N label="Stamped envelope ($)" value={s.buyerShipping.pwe} onChange={(v) => setS({ ...s, buyerShipping: { ...s.buyerShipping, pwe: v } })} hint="One raw card under $20, no tracking" />
          <N label="Tracked bubble mailer ($)" value={s.buyerShipping.bubble} onChange={(v) => setS({ ...s, buyerShipping: { ...s.buyerShipping, bubble: v } })} hint="Graded, $20+, every Lil' Stack" />
          <N label="Free shipping at ($)" value={s.buyerShipping.freeAt} onChange={(v) => setS({ ...s, buyerShipping: { ...s.buyerShipping, freeAt: v } })} hint="Single cards only, never a Lil' Stack" />
        </div>
        <p className="text-[11px] text-navy/50">
          Added on top of the price as its own checkout line. Set a card&apos;s shipping profile to bubble or slab to send it in a mailer under $20. Saving new rates replaces the live pay links.
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Home feature</h2>
        <div>
          <label className="label">Chase list (comma separated)</label>
          <input
            className="input"
            defaultValue={(s.chaseNames ?? []).join(", ")}
            onBlur={(e) => setS({ ...s, chaseNames: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
          <p className="mt-0.5 text-[11px] text-navy/50">
            Names people already chase: +25 wow. Full/illustration/alt art or numbered +40, graded 9–10 +20, newest set in the batch +10. Pin a card or a Lil&apos; Stack as Featured to beat the score.
          </p>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Identification</h2>
        <N label="Confidence threshold" step="0.05" value={s.confidenceThreshold} onChange={(v) => setS({ ...s, confidenceThreshold: v })} hint="Cards under this never auto-advance past Inbox; their shaky fields are highlighted." />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Price rule</h2>
        <p className="text-sm text-navy/70">
          Median of every source that returns a price (one source = that price), rounded to the nearest dollar, minimum $1. No source = $1. Under $1 goes in a
          Lil&apos; Stack. $5 and under goes live on upload; over $5 waits in Needs a look.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <N label="Stale after (hours)" step="1" value={s.staleHours} onChange={(v) => setS({ ...s, staleHours: v })} />
          <N label="Conflict ratio" step="0.1" value={s.conflictRatio} onChange={(v) => setS({ ...s, conflictRatio: v })} hint="Noted on the card when sources differ by more than this ×; never holds a card" />
        </div>
        <div>
          <label className="label">Condition multipliers (applied only to NM source prices)</label>
          <div className="grid grid-cols-5 gap-2">
            {CONDITIONS.map((c) => (
              <div key={c}>
                <div className="text-xs font-semibold">{c}</div>
                <input className="input" type="number" step="0.05" value={s.conditionMultipliers[c]} onChange={(e) => setS({ ...s, conditionMultipliers: { ...s.conditionMultipliers, [c]: num(e.target.value) } })} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Fees + shipping</h2>
        {(["ebay", "tcgplayer", "stripe", "local"] as const).map((ch) => (
          <div key={ch} className="grid grid-cols-[6rem_1fr_1fr] items-end gap-2">
            <div className="pb-2 text-sm font-semibold">{ch}</div>
            <N label="% of sale" value={s.fees[ch].pct} onChange={(v) => setS({ ...s, fees: { ...s.fees, [ch]: { ...s.fees[ch], pct: v } } })} />
            <N label="+ fixed $" value={s.fees[ch].fixed} onChange={(v) => setS({ ...s, fees: { ...s.fees, [ch]: { ...s.fees[ch], fixed: v } } })} />
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2">
          {SHIPPING_PROFILES.map((p) => (
            <N key={p} label={`${p === "bubble" ? "bubble mailer" : p} $`} value={s.shipping[p]} onChange={(v) => setS({ ...s, shipping: { ...s.shipping, [p]: v } })} />
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Listing templates</h2>
        <div>
          <label className="label">Title template</label>
          <input className="input font-mono text-xs" value={s.titleTemplate} onChange={(e) => setS({ ...s, titleTemplate: e.target.value })} />
        </div>
        <div>
          <label className="label">Description template</label>
          <textarea className="input h-40 font-mono text-xs" value={s.descriptionTemplate} onChange={(e) => setS({ ...s, descriptionTemplate: e.target.value })} />
          <p className="mt-0.5 text-[11px] text-navy/50">
            Placeholders: {"{name} {player} {team} {set} {number} {year} {variant} {variant_line} {rarity} {game} {grade} {condition} {condition_long} {shop_note}"}
          </p>
        </div>
        <div>
          <label className="label">Trade Shark note</label>
          <input className="input" value={s.shopNote} onChange={(e) => setS({ ...s, shopNote: e.target.value })} />
        </div>
      </section>

      <section className="card space-y-3 p-4 lg:col-span-2">
        <h2 className="font-bold">eBay draft defaults</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(["Pokemon", "Magic", "Sports", "Other"] as const).map((g) => (
            <div key={g}>
              <label className="label">{g} category id</label>
              <input className="input" value={s.ebayCategory[g]} onChange={(e) => setS({ ...s, ebayCategory: { ...s.ebayCategory, [g]: e.target.value } })} />
            </div>
          ))}
          <div>
            <label className="label">Item location</label>
            <input className="input" value={s.ebayLocation} onChange={(e) => setS({ ...s, ebayLocation: e.target.value })} />
          </div>
          <div>
            <label className="label">Shipping policy name</label>
            <input className="input" value={s.ebayShippingProfileName} onChange={(e) => setS({ ...s, ebayShippingProfileName: e.target.value })} />
          </div>
          <div>
            <label className="label">Return policy name</label>
            <input className="input" value={s.ebayReturnProfileName} onChange={(e) => setS({ ...s, ebayReturnProfileName: e.target.value })} />
          </div>
          <div>
            <label className="label">Payment policy name</label>
            <input className="input" value={s.ebayPaymentProfileName} onChange={(e) => setS({ ...s, ebayPaymentProfileName: e.target.value })} />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3 lg:col-span-2">
        <button className="btn-primary" onClick={() => save()}>Save settings</button>
        <button className="btn-ghost" onClick={() => confirm("Reset all settings to defaults?") && save({ reset: true })}>Reset to defaults</button>
        {msg && <span className="text-sm text-navy/60">{msg}</span>}
      </div>
    </div>
  );
}
