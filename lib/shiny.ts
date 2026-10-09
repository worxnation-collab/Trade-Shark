/**
 * Whether a card's variant has a reflective finish (holo, reverse holo, foil, refractor, parallel). Only these get the
 * small highlight that follows the finger on the big card; commons stay matte. Pure, safe for the browser.
 */
const SHINY = /\b(holo\w*|reverse|foil|refractor\w*|parallel)\b/i;

export const isShiny = (variant: string | null | undefined) => !!variant && SHINY.test(variant);
