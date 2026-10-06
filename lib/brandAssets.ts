/**
 * Static brand art in public/brand, made with Gemini (stills) and Veo (clips) by scripts/gemini-art.mjs.
 * The site never calls Gemini at runtime. A missing clip just means the still shows instead.
 */
export const packStill = (category: string) => `/brand/pack-${category}.webp`;
export const openStill = (category: string) => `/brand/open-${category}.webp`;
export const tearClip = (category: string) => `/brand/tear-${category}.mp4`;
export const passClip = (category: string) => `/brand/pass-${category}.mp4`;
export const HIT_CLIP = "/brand/hit.mp4";
