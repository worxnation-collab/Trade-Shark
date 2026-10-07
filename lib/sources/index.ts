import type { Game } from "../types";
import { ebaySoldPrice, pastedCompsPrice } from "./ebay";
import { justTcgPrice } from "./justtcg";
import { pokemonTcgIdentify, pokemonTcgPrice } from "./pokemontcg";
import { priceChartingPrice } from "./pricecharting";
import { scryfallIdentify, scryfallPrice } from "./scryfall";
import { sportsCatalogIdentify } from "./sportsCatalog";
import type { IdentifyAdapter, PriceAdapter } from "./types";
import { anthropicVision, openaiVision } from "./vision";

/**
 * Source registry. To add a price or identity source: write an adapter in this folder that
 * fails soft (returns status + reason, never throws), then add it to one of these lists.
 */

// Vision runs first so catalogs can search with what it read.
export const VISION_SOURCES: IdentifyAdapter[] = [anthropicVision, openaiVision];
export const CATALOG_SOURCES: IdentifyAdapter[] = [pokemonTcgIdentify, scryfallIdentify, sportsCatalogIdentify];
export const PRICE_SOURCES: PriceAdapter[] = [pokemonTcgPrice, scryfallPrice, ebaySoldPrice, pastedCompsPrice];
/** Asked only when the sources above gave a named card no price: JustTCG for Pokemon, PriceCharting for sports. */
export const FALLBACK_PRICE_SOURCES: PriceAdapter[] = [justTcgPrice, priceChartingPrice];

export function appliesTo(a: { games: Game[] | "any" }, game: Game) {
  return a.games === "any" || a.games.includes(game);
}

export function sourceStatus() {
  return [...VISION_SOURCES, ...CATALOG_SOURCES, ...PRICE_SOURCES, ...FALLBACK_PRICE_SOURCES]
    .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id && b.label === a.label) === i)
    .map((a) => ({ id: a.id, label: a.label, ...a.configured() }));
}
