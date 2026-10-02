import { keys } from "../env";
import type { IdentCandidate } from "../types";
import { fetchJson, limiter } from "../util";
import { calibrate, scoreCandidate } from "./score";
import { fail, none, type IdentifyAdapter, type PriceAdapter, type QuoteInput } from "./types";

const API = "https://api.pokemontcg.io/v2/cards";
const run = limiter(3);

interface PtcgPrice {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
}
export interface PtcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: { id: string; name: string; series: string; printedTotal: number; releaseDate: string; ptcgoCode?: string };
  images?: { small: string; large: string };
  tcgplayer?: { url: string; updatedAt: string; prices?: Record<string, PtcgPrice> };
  cardmarket?: { url: string; updatedAt: string; prices?: Record<string, number | null> };
}

function headers(): Record<string, string> {
  const k = keys().pokemontcg;
  return k ? { "X-Api-Key": k } : {};
}

const esc = (s: string) => s.replace(/["\\]/g, "").trim();

async function search(q: string) {
  const url = `${API}?q=${encodeURIComponent(q)}&pageSize=24&orderBy=-set.releaseDate`;
  return run(() => fetchJson<{ data: PtcgCard[] }>(url, { headers: headers(), timeoutMs: 9000, retries: 1 }));
}

export async function getPtcgCard(id: string) {
  return run(() => fetchJson<{ data: PtcgCard }>(`${API}/${encodeURIComponent(id)}`, { headers: headers(), timeoutMs: 9000, retries: 1 }));
}

export const pokemonTcgIdentify: IdentifyAdapter = {
  id: "pokemontcg",
  label: "Pokemon TCG API",
  games: ["Pokemon", "Other"],
  configured: () => ({ ok: true }), // key optional
  async identify(ctx) {
    const name = ctx.hints.name ? esc(ctx.hints.name) : "";
    const num = ctx.hints.number?.split("/")[0].replace(/^0+(?=\d)/, "");
    if (!name && !num) return none("no name or number to search with");
    const attempts: string[] = [];
    if (name && num) attempts.push(`name:"${name}" number:${esc(num)}`);
    if (name) attempts.push(`name:"${name}"`);
    // Loose prefix search only when a number can confirm the hit.
    if (name && num && name.includes(" ") && name.split(" ")[0].length >= 4) attempts.push(`name:${esc(name.split(" ")[0])}* number:${esc(num)}`);
    if (!name && num && ctx.hints.setName) attempts.push(`number:${esc(num)} set.name:"${esc(ctx.hints.setName)}"`);
    let cards: PtcgCard[] = [];
    let lastErr = "";
    for (const q of attempts) {
      const r = await search(q);
      if (!r.ok) {
        lastErr = r.error;
        continue;
      }
      if (r.data.data.length) {
        cards = r.data.data;
        break;
      }
    }
    if (!cards.length) return lastErr ? fail(lastErr) : none(`no Pokemon card matched ${attempts[0]}`);
    const scored = cards
      .map((c) => ({
        c,
        s: scoreCandidate(ctx.hints, {
          name: c.name,
          number: c.number,
          setName: c.set.name,
          setCode: c.set.ptcgoCode ?? c.set.id,
          printedTotal: c.set.printedTotal,
          year: c.set.releaseDate?.slice(0, 4),
        }),
      }))
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 5);
    const conf = calibrate(scored.map((x) => x.s.score));
    const out: IdentCandidate[] = scored.map(({ c, s }, i) => ({
      source: "pokemontcg",
      confidence: conf[i],
      catalogId: c.id,
      catalogImage: c.images?.small,
      tcgplayerUrl: c.tcgplayer?.url,
      fields: {
        game: "Pokemon",
        name: c.name,
        setName: c.set.name,
        setCode: c.set.ptcgoCode ?? c.set.id,
        number: `${c.number}/${c.set.printedTotal}`,
        year: c.set.releaseDate?.slice(0, 4),
        rarity: c.rarity,
      },
      fieldConfidence: { name: s.name, number: s.number, setName: s.set, setCode: s.set, game: 0.95, year: s.set, rarity: s.set },
    }));
    return { status: "ok", data: out };
  },
};

/** Map our variant text to the TCGplayer price bucket the Pokemon TCG API uses. */
export function pickPriceBucket(prices: Record<string, PtcgPrice>, variant?: string) {
  const v = (variant ?? "").toLowerCase();
  const order = v.includes("reverse")
    ? ["reverseHolofoil"]
    : v.includes("1st") && v.includes("holo")
      ? ["1stEditionHolofoil"]
      : v.includes("1st")
        ? ["1stEditionNormal", "1stEditionHolofoil"]
        : v.includes("holo")
          ? ["holofoil", "unlimitedHolofoil"]
          : ["normal", "holofoil", "unlimited", "unlimitedHolofoil"];
  const key = order.find((k) => prices[k]) ?? Object.keys(prices)[0];
  return key ? { key, p: prices[key] } : null;
}

export const pokemonTcgPrice: PriceAdapter = {
  id: "pokemontcg",
  label: "TCGplayer via Pokemon TCG API",
  games: ["Pokemon"],
  configured: () => ({ ok: true }),
  async price(ctx) {
    if (!ctx.catalogId || ctx.identSource === "scryfall") return none("no Pokemon TCG catalog id — confirm the card first");
    const r = await getPtcgCard(ctx.catalogId);
    if (!r.ok) return fail(r.error);
    const c = r.data.data;
    const quotes: QuoteInput[] = [];
    const tp = c.tcgplayer?.prices ? pickPriceBucket(c.tcgplayer.prices, ctx.fields.variant) : null;
    if (tp) {
      for (const label of ["market", "low", "mid", "high"] as const) {
        const amt = tp.p[label];
        if (typeof amt === "number" && amt > 0)
          quotes.push({
            source: "pokemontcg",
            kind: "market",
            label,
            amount: amt,
            condition: "NM", // TCGplayer market/low/mid/high from this API are Near Mint listings
            rawTitle: `TCGplayer ${label} · ${c.name} ${c.set.name} #${c.number} (${tp.key})`,
            url: c.tcgplayer?.url,
          });
      }
    }
    const cm = c.cardmarket?.prices;
    if (cm?.trendPrice) {
      quotes.push({
        source: "cardmarket",
        kind: "market",
        label: "trend",
        amount: cm.trendPrice,
        currency: "EUR",
        condition: null,
        rawTitle: `Cardmarket trend · ${c.name} ${c.set.name} #${c.number} (reference only, EUR)`,
        url: c.cardmarket?.url,
      });
    }
    if (!quotes.length) return none("Pokemon TCG API has no TCGplayer prices for this card");
    return { status: "ok", data: quotes };
  },
};
