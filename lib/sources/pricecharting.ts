import { fail, none, skip, type PriceAdapter } from "./types";

/**
 * PriceCharting (pricecharting.com/api): the sports price fallback when no other source priced a named card.
 * Searches "<year> <set> <player> #<number>" and takes the ungraded ("loose") price of the best match, only when the
 * product name has the player's last name in it. Key in PRICECHARTING_API_KEY (server only). Never guesses.
 */
const BASE = (process.env.PRICECHARTING_API_BASE || "https://www.pricecharting.com").replace(/\/$/, "");

export function pcQuery(f: { player?: string; name?: string; year?: string; setName?: string; number?: string }) {
  const who = f.player || f.name || "";
  return [f.year, f.setName, who, f.number ? `#${f.number.split("/")[0]}` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export const priceChartingPrice: PriceAdapter = {
  id: "pricecharting",
  label: "PriceCharting",
  games: ["Sports"],
  configured: () => (process.env.PRICECHARTING_API_KEY ? { ok: true } : { ok: false, reason: "PRICECHARTING_API_KEY not set" }),
  async price(ctx) {
    const key = process.env.PRICECHARTING_API_KEY;
    if (!key) return skip("PRICECHARTING_API_KEY not set");
    const who = ctx.fields.player || ctx.fields.name;
    if (!who) return skip("no player name");
    const q = pcQuery(ctx.fields);
    try {
      const r = await fetch(`${BASE}/api/product?${new URLSearchParams({ t: key, q })}`, { signal: AbortSignal.timeout(Number(process.env.PRICECHARTING_TIMEOUT_MS || 12000)) });
      const j = (await r.json().catch(() => ({}))) as { status?: string; "error-message"?: string; "product-name"?: string; "console-name"?: string; "loose-price"?: number };
      if (!r.ok || j.status === "error") return fail(`PriceCharting ${r.status}${j["error-message"] ? `: ${j["error-message"]}` : ""}`);
      const last = who.trim().split(/\s+/).pop()!.toLowerCase();
      if (!(j["product-name"] ?? "").toLowerCase().includes(last)) return none(`PriceCharting: no match for "${q}"`);
      const cents = j["loose-price"];
      if (!cents || cents <= 0) return none(`PriceCharting: ${j["product-name"]} has no ungraded price`);
      return {
        status: "ok",
        data: [{ source: "pricecharting", kind: "market", label: "ungraded", amount: cents / 100, currency: "USD", rawTitle: `${j["product-name"]} · ${j["console-name"] ?? ""}` }],
      };
    } catch (e) {
      return fail(`PriceCharting unreachable: ${e instanceof Error ? e.message : e}`);
    }
  },
};
