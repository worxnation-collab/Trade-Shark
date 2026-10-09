import { sportOf } from "../categories";
import { keys } from "../env";
import { readStored } from "../images";
import type { IdentCandidate } from "../types";
import { fail, none, skip, type IdentifyAdapter } from "./types";

/**
 * CardSight AI (api.cardsight.ai): identifies a card from the scan, for sports (baseball default, football) and
 * Pokemon. Server-side only, key in CARDSIGHT_API_KEY (never sent to the browser). Fails soft like every adapter.
 * It also reports a Pokemon card's energy type (Card.cardType), used by the pack rule "no more than two of one type".
 * No catalogId: Pokemon prices keep coming from the pokemontcg.io match.
 */
const BASE = (process.env.CARDSIGHT_API_BASE || "https://api.cardsight.ai").replace(/\/$/, "");
const CONF: Record<string, number> = { High: 0.95, Medium: 0.75, Low: 0.45 };
export const POKEMON_TYPES = ["grass", "fire", "water", "lightning", "psychic", "fighting", "darkness", "metal", "dragon", "colorless", "fairy"];

interface Detection {
  confidence?: string;
  card?: { id?: string; name?: string; year?: string; manufacturer?: string; releaseName?: string; setName?: string; number?: string; attributes?: string[] };
}

/** A Pokemon card's energy type from CardSight's attributes ("pokemon-grass" → "Grass"). Trainers and energy have none. */
export function cardTypeOf(attributes: string[] | undefined) {
  const t = (attributes ?? []).map((a) => a.replace(/^pokemon-/, "")).find((a) => POKEMON_TYPES.includes(a));
  return t ? t[0].toUpperCase() + t.slice(1) : undefined;
}

export function fromDetection(d: Detection, pokemon: boolean): IdentCandidate | null {
  const c = d.card;
  if (!c?.name) return null;
  const set = [c.releaseName, c.setName && !/^(base set|checklist)$/i.test(c.setName) ? c.setName : null].filter(Boolean).join(" ");
  return {
    source: "cardsight",
    confidence: CONF[d.confidence ?? ""] ?? 0.5,
    fields: pokemon
      ? { game: "Pokemon", name: c.name, setName: set || undefined, number: c.number, year: c.year }
      : { game: "Sports", name: c.name, player: c.name, setName: [c.manufacturer, set].filter(Boolean).join(" ") || undefined, number: c.number, year: c.year },
    cardType: pokemon ? cardTypeOf(c.attributes) : undefined,
    note: c.id ? `CardSight ${c.id}` : "CardSight",
  };
}

export const sportsCatalogIdentify: IdentifyAdapter = {
  id: "cardsight",
  label: "CardSight AI",
  games: ["Sports", "Pokemon"],
  configured: () => (keys().cardsight ? { ok: true } : { ok: false, reason: "CARDSIGHT_API_KEY not set" }),
  async identify(ctx) {
    const key = keys().cardsight;
    if (!key) return skip("CARDSIGHT_API_KEY not set");
    if (!ctx.frontImage) return skip("no front image");
    const img = await readStored(ctx.frontImage).catch(() => null);
    if (!img) return fail("couldn't read the scan");
    const pokemon = ctx.game === "Pokemon";
    const segment = pokemon ? "pokemon" : sportOf({ team: ctx.hints.team, setName: ctx.hints.setName }) === "football" ? "football" : null;
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(img.buf)], { type: img.mime }), "card");
    try {
      const r = await fetch(`${BASE}/v1/identify/card${segment ? `/${segment}` : ""}`, {
        method: "POST",
        headers: { "X-API-Key": key },
        body: form,
        signal: AbortSignal.timeout(Number(process.env.CARDSIGHT_TIMEOUT_MS || 20000)),
      });
      const j = (await r.json().catch(() => ({}))) as { detections?: Detection[]; error?: string };
      if (!r.ok) return fail(`CardSight ${r.status}${j.error ? `: ${j.error}` : ""}`);
      const cands = (j.detections ?? []).map((d) => fromDetection(d, pokemon)).filter((c): c is IdentCandidate => !!c);
      return cands.length ? { status: "ok", data: cands.slice(0, 1) } : none("CardSight found no card");
    } catch (e) {
      return fail(`CardSight unreachable: ${e instanceof Error ? e.message : e}`);
    }
  },
};
