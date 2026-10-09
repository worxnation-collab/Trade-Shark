import scenes from "./brandScenes.json";

/**
 * Static brand art in public/brand, made with Gemini by scripts/gemini-art.mjs. The site never calls Gemini at runtime.
 * The sealed shark pack per category, and one quiet stage per category behind it (lib/brandScenes.json lists what exists;
 * a missing stage returns null and the block stays plain navy).
 */
export const packStill = (category: string) => `/brand/pack-${category}.webp`;
const scene = (name: string): string | null => (scenes as Record<string, string>)[name] ?? null;
export const stageArt = (category: string) => scene(`stage-${category}`);
