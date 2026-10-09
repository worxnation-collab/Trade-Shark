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

/**
 * The sold-comp median from the latest fetch (USD, junk excluded), or null when no sale backs the card. Asks,
 * PriceCharting, JustTCG and the TCGplayer market are never sales, so they never count here.
 */
export function soldCompMedian(quotes: QuoteRow[]): number | null {
  const sold = latestPerSource(quotes).filter((q) => q.kind === "sold_comp" && !q.excluded && q.currency === "USD" && q.source !== "manual");
  return sold.length ? round2(median(sold.map((q) => q.amount))!) : null;
}

/** Only the most recent fetch of each source counts; older rows are history. */
export function latestPerSource(quotes: QuoteRow[]): QuoteRow[] {
  const newest = new Map<string, number>();
  for (const q of quotes) newest.set(q.source, Math.max(newest.get(q.source) ?? 0, q.fetchedAt.getTime()));
  // A single fetch writes all its rows with the same fetchedAt.
  return quotes.filter((q) => q.fetchedAt.getTime() === newest.get(q.source));
}

export interface Suggestion {
  /** Unrounded median of the sources (or the manual price). null = no source returned a number. */
  price: number | null;
  basis: "manual" | "median" | "single" | null;
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
  justtcg: "JustTCG",
  pricecharting: "PriceCharting",
  cardmarket: "Cardmarket (EUR)",
  manual: "Manual",
};
export const sourceName = (s: string) => SOURCE_NAME[s] ?? s;

/**
 * Cute-shop pricing: one headline per source (sold-comp median, TCGplayer market, Scryfall ask,
 * eBay active-ask median, and the JustTCG / PriceCharting fallbacks), then the median of those. One source = that
 * number. None = null: the card is unpriced (never a default price). Disagreement is recorded, never a reason to hold.
 */
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
  const market = quotes.find((q) => q.source === "pokemontcg" && q.label === "market" && usd(q) && !q.excluded);
  const ask = quotes.find((q) => q.kind === "retail_ask" && q.source === "scryfall" && usd(q) && !q.excluded);
  const activeAsks = quotes.filter((q) => q.source === "ebay_active" && !q.excluded && usd(q));
  const fallbacks = quotes.filter((q) => (q.source === "justtcg" || q.source === "pricecharting") && !q.excluded && usd(q) && q.amount > 0);

  const headlines: (Suggestion["headlines"][number] & { nm: boolean })[] = [];
  if (soldStats) headlines.push({ source: "sold", label: `Sold median (${soldStats.n})`, amount: soldStats.median, nm: sold.every((q) => q.condition === "NM") });
  if (market) headlines.push({ source: "pokemontcg", label: "TCGplayer market", amount: market.amount, nm: market.condition === "NM" });
  if (ask) headlines.push({ source: "scryfall", label: `Scryfall ${ask.label}`, amount: ask.amount, nm: ask.condition === "NM" });
  if (activeAsks.length)
    headlines.push({ source: "ebay_active", label: `eBay active median (${activeAsks.length})`, amount: round2(median(activeAsks.map((q) => q.amount))!), nm: false });
  for (const f of fallbacks) headlines.push({ source: f.source, label: sourceName(f.source), amount: f.amount, nm: f.condition === "NM" });

  const amts = headlines.map((h) => h.amount).filter((a) => a > 0);
  const conflict = amts.length >= 2 && Math.max(...amts) / Math.min(...amts) > s.conflictRatio;
  if (conflict) notes.push(`Sources disagree by more than ${s.conflictRatio}x; using the median anyway.`);

  let basis: Suggestion["basis"] = null;
  let basisAmount: number | null = null;
  let basisLabel = "No price source";
  if (amts.length) {
    basisAmount = round2(median(amts)!);
    basis = amts.length === 1 ? "single" : "median";
    basisLabel = amts.length === 1 ? headlines.find((h) => h.amount > 0)!.label : `Median of ${amts.length} sources`;
  } else notes.push("No source returned a price.");

  // Condition only discounts when every source priced NM copies.
  let multiplier = 1;
  const cond = (card.condition || "NM") as Condition;
  const allNM = headlines.length > 0 && headlines.every((h) => h.nm);
  if (basisAmount != null && allNM && !card.graded && cond !== "NM") {
    multiplier = s.conditionMultipliers[cond] ?? 1;
    notes.push(`${cond} multiplier ${multiplier} applied to NM source prices.`);
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
    headlines: headlines.map(({ nm: _nm, ...h }) => h),
    conflict,
    notes,
  };
}

/**
 * The shop price of a card from its suggestion.
 * - Under $1 stays exact; the pack price adds those up.
 * - Otherwise round to the nearest dollar, minimum $1.
 * - No source at all = null (unpriced). Never a default: an unpriced card stays out of packs until I type a price.
 */
export function shopPrice(raw: number | null, manual?: number | null): number | null {
  if (manual != null) return manual;
  if (raw == null) return null;
  if (raw < LIL_STACK_UNDER) return round2(raw);
  return Math.max(1, Math.round(raw));
}

export type Channel = "ebay" | "tcgplayer" | "stripe" | "local";

export function netAfterFees(price: number, channel: Channel, profile: ShippingProfile, s: Settings) {
  const f = s.fees[channel];
  const fees = round2((price * f.pct) / 100 + f.fixed);
  const ship = channel === "local" ? 0 : s.shipping[profile] ?? 0;
  return { fees, ship, net: round2(price - fees - ship) };
}

/** Under this the price stays exact (cents) instead of rounding to the dollar. */
export const LIL_STACK_UNDER = 1;

/**
 * Status after pricing. Never moves a card past Priced on its own.
 * A packed card stays in its pack at any price (the pack's price follows the sum).
 */
export function statusAfterPricing(current: string, price: number | null, identOk: boolean, s: Settings): string {
  if (current === "LilStack" && price != null) return "LilStack";
  if (!["Inbox", "Identified", "Priced", "BulkHold", "LilStack"].includes(current)) return current;
  if (!identOk) return "Inbox";
  if (price == null) return "Identified";
  if (price < s.minListPrice) return "BulkHold";
  return "Priced";
}
