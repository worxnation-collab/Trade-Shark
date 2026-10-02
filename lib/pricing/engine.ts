import type { Settings } from "../settings";
import type { Condition, ShippingProfile } from "../types";
import { median, round2 } from "../util";

export interface QuoteRow {
  id?: string;
  source: string;
  kind: string;
  label: string | null;
  amount: number;
  currency: string;
  condition: string | null;
  rawTitle: string | null;
  url?: string | null;
  soldAt?: Date | null;
  excluded: boolean;
  excludeReason?: string | null;
  fetchedAt: Date;
}

/** Only the most recent fetch of each source counts; older rows are history. */
export function latestPerSource(quotes: QuoteRow[]): QuoteRow[] {
  const newest = new Map<string, number>();
  for (const q of quotes) newest.set(q.source, Math.max(newest.get(q.source) ?? 0, q.fetchedAt.getTime()));
  // A single fetch writes all its rows with the same fetchedAt.
  return quotes.filter((q) => q.fetchedAt.getTime() === newest.get(q.source));
}

export interface Suggestion {
  price: number | null;
  basis: "manual" | "sold_median" | "tcg_market" | "retail_ask" | null;
  basisLabel: string;
  basisAmount: number | null;
  multiplier: number;
  compCount: number;
  soldStats: { median: number; low: number; high: number; n: number; last5: QuoteRow[] } | null;
  headlines: { source: string; label: string; amount: number }[];
  conflict: boolean;
  notes: string[];
}

const SOURCE_NAME: Record<string, string> = {
  ebay_sold: "eBay sold",
  pasted: "Pasted comps",
  pokemontcg: "TCGplayer market",
  scryfall: "Scryfall ask",
  ebay_active: "eBay active asks",
  cardmarket: "Cardmarket (EUR)",
  manual: "Manual",
};
export const sourceName = (s: string) => SOURCE_NAME[s] ?? s;

export function suggest(
  allQuotes: QuoteRow[],
  card: { condition: string; graded?: string | null; manualPrice?: number | null; variant?: string | null },
  s: Settings,
): Suggestion {
  const quotes = latestPerSource(allQuotes).filter((q) => q.source !== "manual");
  const notes: string[] = [];
  const usd = (q: QuoteRow) => q.currency === "USD";

  const sold = quotes.filter((q) => q.kind === "sold_comp" && !q.excluded && usd(q));
  const soldStats = sold.length
    ? {
        median: round2(median(sold.map((q) => q.amount))!),
        low: Math.min(...sold.map((q) => q.amount)),
        high: Math.max(...sold.map((q) => q.amount)),
        n: sold.length,
        last5: [...sold].sort((a, b) => (b.soldAt?.getTime() ?? 0) - (a.soldAt?.getTime() ?? 0)).slice(0, 5),
      }
    : null;
  const soldNM = sold.length > 0 && sold.every((q) => q.condition === "NM");

  const market = quotes.find((q) => q.source === "pokemontcg" && q.label === "market" && usd(q));
  const ask = quotes.find((q) => q.kind === "retail_ask" && q.source === "scryfall" && usd(q));
  const activeAsks = quotes.filter((q) => q.source === "ebay_active" && !q.excluded);

  const headlines: Suggestion["headlines"] = [];
  if (soldStats) headlines.push({ source: "sold", label: `Sold median (${soldStats.n})`, amount: soldStats.median });
  if (market) headlines.push({ source: "pokemontcg", label: "TCGplayer market", amount: market.amount });
  if (ask) headlines.push({ source: "scryfall", label: `Scryfall ${ask.label}`, amount: ask.amount });
  if (activeAsks.length >= 3)
    headlines.push({ source: "ebay_active", label: `eBay active median (${activeAsks.length})`, amount: round2(median(activeAsks.map((q) => q.amount))!) });

  const amts = headlines.map((h) => h.amount).filter((a) => a > 0);
  const conflict = amts.length >= 2 && Math.max(...amts) / Math.min(...amts) > s.conflictRatio;
  if (conflict) notes.push(`Sources disagree by more than ${s.conflictRatio}x — check before trusting the suggestion.`);

  let basis: Suggestion["basis"] = null;
  let basisAmount: number | null = null;
  let basisLabel = "No price";
  let basisNM = false;
  if (soldStats && soldStats.n >= s.minComps) {
    basis = "sold_median";
    basisAmount = soldStats.median;
    basisLabel = `Median of ${soldStats.n} sold comps`;
    basisNM = soldNM;
  } else if (s.useTcgMarket && market) {
    basis = "tcg_market";
    basisAmount = market.amount;
    basisLabel = "TCGplayer market";
    basisNM = market.condition === "NM";
    if (soldStats) notes.push(`Only ${soldStats.n} clean sold comp(s); need ${s.minComps} to use sold median.`);
  } else if (s.useRetailAskFallback && ask) {
    basis = "retail_ask";
    basisAmount = ask.amount;
    basisLabel = `Scryfall ${ask.label} (retail ask)`;
    basisNM = ask.condition === "NM";
  } else if (soldStats) {
    notes.push(`Only ${soldStats.n} clean sold comp(s); need ${s.minComps}. No market fallback available.`);
  }

  let multiplier = 1;
  const cond = (card.condition || "NM") as Condition;
  if (basisAmount != null && basisNM && !card.graded && cond !== "NM") {
    multiplier = s.conditionMultipliers[cond] ?? 1;
    notes.push(`${cond} multiplier ${multiplier} applied to an NM source price.`);
  } else if (basisAmount != null && !basisNM && cond !== "NM") {
    notes.push(`Source price condition unknown — ${cond} multiplier not applied.`);
  }

  let price = basisAmount != null ? round2(basisAmount * multiplier) : null;
  if (card.manualPrice != null) {
    price = card.manualPrice;
    basis = "manual";
    basisLabel = "Manual";
    notes.unshift("Manual override wins.");
  }
  return {
    price,
    basis,
    basisLabel,
    basisAmount,
    multiplier,
    compCount: soldStats?.n ?? 0,
    soldStats,
    headlines,
    conflict,
    notes,
  };
}

export type Channel = "ebay" | "tcgplayer" | "stripe" | "local";

export function netAfterFees(price: number, channel: Channel, profile: ShippingProfile, s: Settings) {
  const f = s.fees[channel];
  const fees = round2((price * f.pct) / 100 + f.fixed);
  const ship = channel === "local" ? 0 : s.shipping[profile] ?? 0;
  return { fees, ship, net: round2(price - fees - ship) };
}

/** Status after pricing. Never moves a card past Priced on its own. */
export function statusAfterPricing(current: string, price: number | null, identOk: boolean, s: Settings): string {
  if (!["Inbox", "Identified", "Priced", "BulkHold"].includes(current)) return current;
  if (!identOk) return "Inbox";
  if (price == null) return "Identified";
  if (price < s.minListPrice) return "BulkHold";
  return "Priced";
}
