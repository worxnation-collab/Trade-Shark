import type { IdentCandidate } from "../types";
import { fetchJson, limiter } from "../util";
import { calibrate, scoreCandidate } from "./score";
import { fail, none, type IdentifyAdapter, type PriceAdapter, type QuoteInput } from "./types";

const API = "https://api.scryfall.com";
// Scryfall asks for <= 10 req/s and a real User-Agent.
const run = limiter(2);
const H = { "User-Agent": "TradeShark/0.1 (personal card shop)", Accept: "application/json" };

export interface ScryCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  released_at: string;
  finishes?: string[];
  tcgplayer_id?: number;
  prices: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null; eur?: string | null };
  purchase_uris?: { tcgplayer?: string };
  image_uris?: { small?: string; normal?: string };
  card_faces?: { image_uris?: { small?: string } }[];
}

async function get<T>(path: string) {
  return run(async () => {
    const r = await fetchJson<T>(`${API}${path}`, { headers: H, timeoutMs: 8000, retries: 1 });
    await new Promise((res) => setTimeout(res, 110));
    return r;
  });
}

const img = (c: ScryCard) => c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small;

export const scryfallIdentify: IdentifyAdapter = {
  id: "scryfall",
  label: "Scryfall",
  games: ["Magic", "Other"],
  configured: () => ({ ok: true }),
  async identify(ctx) {
    const { name, setCode, number } = ctx.hints;
    let cards: ScryCard[] = [];
    let err = "";
    if (setCode && number) {
      const r = await get<ScryCard>(`/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(number.split("/")[0])}`);
      if (r.ok) cards = [r.data];
    }
    if (!cards.length && name) {
      const r = await get<{ data: ScryCard[] }>(
        `/cards/search?unique=prints&order=released&q=${encodeURIComponent(`!"${name.replace(/"/g, "")}"`)}`,
      );
      if (r.ok) cards = r.data.data.slice(0, 40);
      else if (r.status !== 404) err = r.error;
      if (!cards.length) {
        const f = await get<ScryCard>(`/cards/named?fuzzy=${encodeURIComponent(name)}`);
        if (f.ok) cards = [f.data];
        else if (f.status !== 404) err = f.error;
      }
    }
    if (!cards.length) return err ? fail(err) : none(name ? `no Magic card named "${name}"` : "no name or set+number to search with");
    const scored = cards
      .map((c) => ({
        c,
        s: scoreCandidate(ctx.hints, {
          name: c.name,
          number: c.collector_number,
          setName: c.set_name,
          setCode: c.set,
          year: c.released_at?.slice(0, 4),
        }),
      }))
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 5);
    const conf = calibrate(scored.map((x) => x.s.score));
    const out: IdentCandidate[] = scored.map(({ c, s }, i) => ({
      source: "scryfall",
      confidence: conf[i],
      catalogId: c.id,
      catalogImage: img(c),
      tcgplayerId: c.tcgplayer_id ? String(c.tcgplayer_id) : undefined,
      tcgplayerUrl: c.purchase_uris?.tcgplayer,
      fields: {
        game: "Magic",
        name: c.name,
        setName: c.set_name,
        setCode: c.set.toUpperCase(),
        number: c.collector_number,
        year: c.released_at?.slice(0, 4),
        rarity: c.rarity,
      },
      fieldConfidence: { name: s.name, number: s.number, setName: s.set, setCode: s.set, game: 0.95, year: s.set, rarity: s.set },
    }));
    return { status: "ok", data: out };
  },
};

export const scryfallPrice: PriceAdapter = {
  id: "scryfall",
  label: "Scryfall (retail asks)",
  games: ["Magic"],
  configured: () => ({ ok: true }),
  async price(ctx) {
    if (!ctx.catalogId || ctx.identSource === "pokemontcg") return none("no Scryfall id — confirm the card first");
    const r = await get<ScryCard>(`/cards/${encodeURIComponent(ctx.catalogId)}`);
    if (!r.ok) return fail(r.error);
    const c = r.data;
    const isFoil = /foil|etched/i.test(ctx.fields.variant ?? "") && !/non-?foil/i.test(ctx.fields.variant ?? "");
    const quotes: QuoteInput[] = [];
    const add = (label: string, v: string | null | undefined, note: string) => {
      const n = v ? Number(v) : NaN;
      if (n > 0)
        quotes.push({
          source: "scryfall",
          kind: "retail_ask",
          label,
          amount: n,
          condition: "NM",
          rawTitle: `Scryfall ${note} · ${c.name} ${c.set.toUpperCase()} #${c.collector_number} — retail ask, not a sold comp`,
          url: c.purchase_uris?.tcgplayer,
        });
    };
    // Put the matching finish first; the other one stays visible as context.
    if (isFoil) {
      add("usd_foil", c.prices.usd_foil, "usd_foil");
      add("usd_etched", c.prices.usd_etched, "usd_etched");
      add("usd", c.prices.usd, "usd (non-foil)");
    } else {
      add("usd", c.prices.usd, "usd");
      add("usd_foil", c.prices.usd_foil, "usd_foil");
    }
    if (!quotes.length) return none("Scryfall has no USD price for this printing");
    return { status: "ok", data: quotes };
  },
};
