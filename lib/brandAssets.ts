/**
 * The brand is Pokéroll, one product with pokeroll.fun: the mark is public/logo-mark.png (shared with pokeroll.fun),
 * the pack is drawn in code (components/Pack.tsx: ink body, one yellow edge, the mark, the category name). Stages are
 * flat color (components/Stage.tsx). Type is the system face. The shop is the light canvas with ink and yellow; the
 * desk is a dark bench. lib/brandScenes.json stays empty; nothing here calls an image API.
 */

/** The name printed on each category's pack. */
export const PACK_NAME: Record<string, string> = { pokemon: "Pokémon", baseball: "Baseball", football: "Football" };
