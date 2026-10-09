import { fail, none, skip, type PriceAdapter } from "./types";

/**
 * JustTCG (api.justtcg.com): the Pokemon price fallback when no other source priced a named card. Looks the card up
 * by name (+ number) and takes the Near Mint, Normal-print price of the match whose number and set agree. Key in
 * JUSTTCG_API_KEY (server only). No match or no price = no quote; it never guesses.
 */
const BASE = (process.env.JUSTTCG_API_BASE || "https://api.justtcg.com/v1").replace(/\/$/, "");

interface Variant {
  condition?: string;
  printing?: string;
  price?: number | null;
}
interface JCard {
  name?: string;
  set?: string;
  set_name?: string;
  number?: string | null;
  variants?: Variant[];
}

/** "074/172" → "74"; "SWSH050" stays. Compares the card number left of the slash, without leading zeros. */
export const numKey = (n?: string | null) => (n ?? "").split("/")[0].trim().replace(/^0+(?=\w)/, "").toLowerCase();
const words = (s?: string | null) => new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

export function pickJustTcg(cards: JCard[], want: { name: string; number?: string; setName?: string }) {
  const nm = want.name.toLowerCase().replace(/\s*\(.*\)$/, "").trim();
  const sameName = cards.filter((c) => (c.name ?? "").toLowerCase().startsWith(nm));
  const byNumber = want.number ? sameName.filter((c) => numKey(c.number) === numKey(want.number)) : sameName;
  if (want.number && !byNumber.length) return null; // a number we can't match: don't take some other printing's price
  const setWords = words(want.setName);
  const scored = byNumber
    .map((c) => ({ c, s: [...words(c.set_name ?? c.set)].filter((w) => setWords.has(w)).length }))
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  if (!want.number && scored.length > 1 && scored[0].s === scored[1].s) return null; // ambiguous without a number
  const v = scored[0].c.variants ?? [];
  const nmv = v.filter((x) => /near mint|^nm$/i.test(x.condition ?? "") && typeof x.price === "number" && x.price > 0);
  const pick = nmv.find((x) => /normal/i.test(x.printing ?? "")) ?? nmv.sort((a, b) => a.price! - b.price!)[0];
  return pick ? { card: scored[0].c, price: pick.price!, printing: pick.printing ?? "" } : null;
}

export const justTcgPrice: PriceAdapter = {
  id: "justtcg",
  label: "JustTCG",
  games: ["Pokemon"],
  configured: () => (process.env.JUSTTCG_API_KEY ? { ok: true } : { ok: false, reason: "JUSTTCG_API_KEY not set" }),
  async price(ctx) {
    const key = process.env.JUSTTCG_API_KEY;
    if (!key) return skip("JUSTTCG_API_KEY not set");
    const name = ctx.fields.name?.replace(/\s*\(.*\)$/, "").trim();
    if (!name) return skip("no card name");
    const q = new URLSearchParams({ q: name, game: "pokemon", limit: "20" });
    try {
      const r = await fetch(`${BASE}/cards?${q}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(Number(process.env.JUSTTCG_TIMEOUT_MS || 12000)) });
      const j = (await r.json().catch(() => ({}))) as { data?: JCard[]; error?: string; message?: string };
      if (!r.ok) return fail(`JustTCG ${r.status}${j.error || j.message ? `: ${j.error || j.message}` : ""}`);
      const hit = pickJustTcg(j.data ?? [], { name, number: ctx.fields.number, setName: ctx.fields.setName });
      if (!hit) return none(`JustTCG: no ${name}${ctx.fields.number ? ` #${ctx.fields.number}` : ""} with a Near Mint price`);
      return {
        status: "ok",
        data: [{ source: "justtcg", kind: "market", label: "market", amount: Math.round(hit.price * 100) / 100, currency: "USD", condition: "NM", rawTitle: `${hit.card.name} · ${hit.card.set_name ?? hit.card.set ?? ""} #${hit.card.number ?? ""} · ${hit.printing}` }],
      };
    } catch (e) {
      return fail(`JustTCG unreachable: ${e instanceof Error ? e.message : e}`);
    }
  },
};
