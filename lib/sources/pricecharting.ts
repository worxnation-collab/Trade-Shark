import { fail, none, skip, type PriceAdapter } from "./types";

/**
 * Sports card price fallback when no other source priced a named card: the PriceCharting API on SportsCardsPro
 * (PriceCharting's sports-card site; the same token works on both, but only SportsCardsPro lists sports cards).
 * Takes the ungraded ("loose") price only for a confident match: a Football/Baseball Cards set, the player's last name,
 * the exact card number, the base card (or the parallel named on our card), and one set. Anything else = no price.
 * Key in PRICECHARTING_API_KEY (server only). One call per card (their limit is one per second).
 */
const BASE = (process.env.PRICECHARTING_API_BASE || "https://www.sportscardspro.com").replace(/\/$/, "");

export interface PcProduct {
  id?: string;
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
}

const numOf = (s?: string | null) => (s ?? "").split("/")[0].replace(/^#/, "").trim().replace(/^0+(?=\w)/, "").toUpperCase();
const lastName = (who: string) => who.replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "").trim().split(/\s+/).pop()!.toLowerCase();

export function pcQuery(f: { player?: string; name?: string; year?: string; setName?: string; number?: string }) {
  const who = f.player || f.name || "";
  const set = (f.setName ?? "").replace(/\bTopps\s+(?=Bowman)/i, "").replace(/\b(\d{4})\b/g, "").trim();
  return [who, f.year, set, f.number ? `#${numOf(f.number)}` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** The one product that is this card, or null when it isn't clear. */
export function pickPc(products: PcProduct[], f: { player?: string; name?: string; year?: string; number?: string; variant?: string }) {
  const who = f.player || f.name;
  if (!who || !f.number) return null; // without a number there is no telling the base card from the inserts
  const last = lastName(who);
  const want = numOf(f.number);
  const cards = products.filter((p) => {
    const name = (p["product-name"] ?? "").toLowerCase();
    const num = (p["product-name"] ?? "").match(/#\s*([A-Za-z0-9-]+)/)?.[1];
    return /^(football|baseball) cards\b/i.test(p["console-name"] ?? "") && name.includes(last) && numOf(num) === want;
  });
  const variant = (f.variant ?? "").toLowerCase();
  const fits = cards.filter((p) => {
    const bracket = (p["product-name"] ?? "").match(/\[([^\]]+)\]/)?.[1]?.toLowerCase();
    return !bracket || (!!variant && variant.includes(bracket));
  });
  const inYear = f.year ? fits.filter((p) => (p["console-name"] ?? "").includes(f.year!)) : [];
  const pool = inYear.length ? inYear : fits;
  if (new Set(pool.map((p) => p["console-name"])).size !== 1) return null; // no match, or two different sets
  const priced = pool.filter((p) => (p["loose-price"] ?? 0) > 0).sort((a, b) => ((a["product-name"] ?? "").includes("[") ? 1 : 0) - ((b["product-name"] ?? "").includes("[") ? 1 : 0));
  return priced[0] ?? null;
}

export const priceChartingPrice: PriceAdapter = {
  id: "pricecharting",
  label: "PriceCharting (SportsCardsPro)",
  games: ["Sports"],
  configured: () => (process.env.PRICECHARTING_API_KEY ? { ok: true } : { ok: false, reason: "PRICECHARTING_API_KEY not set" }),
  async price(ctx) {
    const key = process.env.PRICECHARTING_API_KEY;
    if (!key) return skip("PRICECHARTING_API_KEY not set");
    const who = ctx.fields.player || ctx.fields.name;
    if (!who) return skip("no player name");
    if (!ctx.fields.number) return none("no card number to match on");
    const q = pcQuery(ctx.fields);
    try {
      const r = await fetch(`${BASE}/api/products?${new URLSearchParams({ t: key, q })}`, { signal: AbortSignal.timeout(Number(process.env.PRICECHARTING_TIMEOUT_MS || 12000)) });
      const j = (await r.json().catch(() => ({}))) as { status?: string; "error-message"?: string; products?: PcProduct[] };
      if (!r.ok || j.status === "error") return fail(`PriceCharting ${r.status}${j["error-message"] ? `: ${j["error-message"]}` : ""}`);
      const hit = pickPc(j.products ?? [], ctx.fields);
      if (!hit) {
        const seen = (j.products ?? []).find((p) => pickPc([{ ...p, "loose-price": 1 }], ctx.fields));
        return none(seen ? `PriceCharting: ${seen["product-name"]} · ${seen["console-name"]} has no ungraded sales yet` : `PriceCharting: no single match for "${q}"`);
      }
      return {
        status: "ok",
        data: [{ source: "pricecharting", kind: "market", label: "ungraded", amount: hit["loose-price"]! / 100, currency: "USD", rawTitle: `${hit["product-name"]} · ${hit["console-name"]}` }],
      };
    } catch (e) {
      return fail(`PriceCharting unreachable: ${e instanceof Error ? e.message : e}`);
    }
  },
};
