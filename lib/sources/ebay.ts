import { keys } from "../env";
import { fetchJson } from "../util";
import { compSearchQuery, compsAreNM, filterComps, parsePastedComps, type Comp } from "./comps";
import { fail, none, skip, type PriceAdapter, type QuoteInput } from "./types";

/**
 * eBay comps.
 * - Sold comps need the Marketplace Insights API (item_sales/search). eBay gates it per app.
 * - If the app can't use it, we fall back to the Browse API, which only returns ACTIVE listings.
 *   Those are saved as "ebay_active" retail asks and never count as sold comps.
 */

let token: { value: string; scope: string; exp: number } | null = null;

async function getToken(scope: string) {
  const { ebayId, ebaySecret } = keys();
  if (token && token.scope === scope && token.exp > Date.now() + 60_000) return { ok: true as const, token: token.value };
  const res = await fetchJson<{ access_token: string; expires_in: number }>("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${ebayId}:${ebaySecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
    retries: 0,
  });
  if (!res.ok) return { ok: false as const, error: `token: ${res.error}` };
  token = { value: res.data.access_token, scope, exp: Date.now() + res.data.expires_in * 1000 };
  return { ok: true as const, token: token.value };
}

const CATEGORY: Record<string, string> = { Pokemon: "183454", Magic: "183454", Sports: "261328", Other: "" };

function toQuotes(comps: Comp[], source: string, kind: QuoteInput["kind"], nm: boolean): QuoteInput[] {
  return comps.map((c) => ({
    source,
    kind,
    label: "comp",
    excluded: !!c.excluded,
    excludeReason: c.excludeReason,
    amount: c.amount,
    currency: c.currency,
    condition: nm ? "NM" : null,
    rawTitle: c.title,
    url: c.url,
    soldAt: c.soldAt,
  }));
}

export const ebaySoldPrice: PriceAdapter = {
  id: "ebay",
  label: "eBay sold comps",
  games: "any",
  configured: () =>
    keys().ebayId && keys().ebaySecret ? { ok: true } : { ok: false, reason: "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set — paste sold comps instead" },
  async price(ctx) {
    const { ebayId, ebaySecret, ebayMarketplace } = keys();
    if (!ebayId || !ebaySecret) return skip("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set — paste sold comps instead");
    const q = compSearchQuery(ctx.fields);
    if (!q || !(ctx.fields.name || ctx.fields.player)) return none("not enough identity to search eBay");
    const cat = CATEGORY[ctx.game] ? `&category_ids=${CATEGORY[ctx.game]}` : "";
    const headers = (t: string) => ({ Authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": ebayMarketplace });

    // 1) Sold comps via Marketplace Insights
    const ti = await getToken("https://api.ebay.com/oauth/api_scope/buy.marketplace.insights");
    let insightsWhy = "";
    if (ti.ok) {
      const r = await fetchJson<{ itemSales?: { title: string; lastSoldPrice?: { value: string; currency: string }; lastSoldDate?: string; itemWebUrl?: string }[] }>(
        `https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?q=${encodeURIComponent(q)}${cat}&limit=50`,
        { headers: headers(ti.token), retries: 1 },
      );
      if (r.ok) {
        const comps: Comp[] = (r.data.itemSales ?? [])
          .filter((s) => s.lastSoldPrice)
          .map((s) => ({
            title: s.title,
            amount: Number(s.lastSoldPrice!.value),
            currency: s.lastSoldPrice!.currency,
            soldAt: s.lastSoldDate ? new Date(s.lastSoldDate) : undefined,
            url: s.itemWebUrl,
          }))
          .filter((c) => c.currency === "USD");
        if (!comps.length) return none(`no eBay sold results for "${q}"`);
        const filtered = filterComps(comps, ctx.fields);
        return { status: "ok", data: toQuotes(filtered, "ebay_sold", "sold_comp", compsAreNM(filtered)) };
      }
      insightsWhy = r.error;
    } else insightsWhy = ti.error;

    // 2) Fallback: active listings via Browse (asks, not sold)
    const tb = await getToken("https://api.ebay.com/oauth/api_scope");
    if (!tb.ok) return fail(`Insights unavailable (${insightsWhy}); Browse token failed (${tb.error})`);
    const r = await fetchJson<{ itemSummaries?: { title: string; price?: { value: string; currency: string }; itemWebUrl?: string; buyingOptions?: string[] }[] }>(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}${cat}&limit=50&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}`,
      { headers: headers(tb.token), retries: 1 },
    );
    if (!r.ok) return fail(`Insights unavailable (${insightsWhy}); Browse failed (${r.error})`);
    const asks: Comp[] = (r.data.itemSummaries ?? [])
      .filter((s) => s.price && s.price.currency === "USD")
      .map((s) => ({ title: s.title, amount: Number(s.price!.value), currency: "USD", url: s.itemWebUrl }));
    if (!asks.length) return none(`no eBay results for "${q}" (sold comps unavailable: ${insightsWhy.slice(0, 80)})`);
    const filtered = filterComps(asks, ctx.fields);
    return {
      status: "ok",
      reason: `sold comps unavailable (${insightsWhy.slice(0, 120)}); saved active asks instead`,
      data: toQuotes(filtered, "ebay_active", "retail_ask", false),
    };
  },
};

export const pastedCompsPrice: PriceAdapter = {
  id: "pasted",
  label: "Pasted sold comps",
  games: "any",
  configured: () => ({ ok: true }),
  async price(ctx) {
    if (!ctx.pastedComps?.trim()) return skip("nothing pasted");
    const comps = parsePastedComps(ctx.pastedComps);
    if (!comps.length) return none("couldn't find any $ prices in the pasted block");
    const filtered = filterComps(comps, ctx.fields);
    return { status: "ok", data: toQuotes(filtered, "pasted", "sold_comp", compsAreNM(filtered)) };
  },
};
