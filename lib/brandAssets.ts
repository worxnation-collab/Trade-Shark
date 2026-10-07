import scenes from "./brandScenes.json";

/**
 * Static brand art in public/brand, made with Gemini (stills) and Veo (clips) by scripts/gemini-art.mjs.
 * The site never calls Gemini at runtime. A missing clip just means the still shows instead.
 */
export const packStill = (category: string) => `/brand/pack-${category}.webp`;
export const openStill = (category: string) => `/brand/open-${category}.webp`;
export const tearClip = (category: string) => `/brand/tear-${category}.mp4`;
export const passClip = (category: string) => `/brand/pass-${category}.mp4`;
export const HIT_CLIP = "/brand/hit.mp4";

/*
 * Scene art (scripts/gemini-art.mjs scenes): pack stages, page headers, title stickers, a pattern tile.
 * lib/brandScenes.json lists the ones that were made; anything missing returns null and the page keeps its plain block.
 */
const scene = (name: string): string | null => (scenes as Record<string, string>)[name] ?? null;
export const stageArt = (category: string) => scene(`stage-${category}`);
export const headerArt = (page: "packs" | "collection" | "consign") => scene(`header-${page}`);
export const titleArt = (which: "pick" | "tradeshark") => scene(`title-${which}`);
export const patternArt = () => scene("pattern");

/** One sport accent per category (matches its stage art): leather red, turf green, arcade yellow. */
export const ACCENT: Record<string, string> = { baseball: "#9E2B25", football: "#2F7D3A", pokemon: "#FFD23F" };
