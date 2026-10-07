#!/usr/bin/env node
/**
 * Brand art for the shop, made with Gemini and trimmed with ffmpeg into small static files in public/brand/.
 * Run by hand when the art should change; the site never calls Gemini.
 *
 *   GEMINI_API_KEY=... node scripts/gemini-art.mjs packs [name...]    # the sealed shark pack per category, green screen keyed to alpha
 *   GEMINI_API_KEY=... node scripts/gemini-art.mjs scenes [name...]   # one quiet stage per category behind the pack
 *   node scripts/gemini-art.mjs scenes-recut [name...]                # re-crop/re-key saved PNGs (no Gemini call)
 *   node scripts/gemini-art.mjs scenes-manifest                       # rewrite lib/brandScenes.json
 *
 * Text prompts only, never card photos. No league, Pokemon, Nintendo or Disney characters or logos, no text.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY && !["scenes-recut", "scenes-manifest"].includes(process.argv[2])) throw new Error("Set GEMINI_API_KEY");
const OUT = path.resolve("public/brand");
const RAW = path.resolve(process.env.ART_RAW_DIR || ".art-raw");
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });
const API = "https://generativelanguage.googleapis.com/v1beta";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";

async function api(url, body) {
  const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

const CATS = ["baseball", "football", "pokemon"];

// The sealed pack: a navy foil pack with a cream band and the small navy fin on one gold line. Quiet, no effects.
const THEME = {
  baseball: "A few faint curved baseball seam stitches in muted red near the top and bottom corners of the navy foil.",
  football: "A faint row of cream lace stitching near the bottom of the navy foil.",
  pokemon: "A faint flat violet tint on the navy foil. Nothing else: no orbs, no sparks, no lightning, no stars, no creatures.",
};
const PACK = (cat) => `Draw one sealed foil trading-card booster pack, front view, standing upright and centered, small in the frame with wide empty margins.
The pack is matte navy (#0B1F3A) with a cream (#F4EFE6) band across the middle. On the band, a simple flat navy geometric shark-fin triangle sitting on one thin gold (#D9A441) line.
Crimped silver foil seals at top and bottom. ${THEME[cat]}
Quiet, premium, flat vector with a soft natural light, low contrast. No glow, no sparkles, no halftone, no comic style, no lightning, no bursts.
Strictly no text, letters or numbers, no logos, no characters.
Background: perfectly flat pure green (#00FF00) chroma-key screen, edge to edge, no shadow on it, nothing else in the frame.`;
const PACKS = Object.fromEntries(CATS.map((c) => [`pack-${c}`, { ratio: "3:4", out: "webp", width: 480, key: true, prompt: PACK(c) }]));

/* ------------------------------------------------------------------ scenes: stages, headers, titles, pattern */

// A quiet card counter: cream paper, navy ink, one gold edge. Stages are tight, dark, calm photographs-in-paint
// with lots of empty centre for the pack. No halftone, no lightning, no comic bursts, no glow.
const LOOK = `Style: quiet, tactile, premium still-life. Soft natural light, low contrast, muted and darkened, lots of empty space.
Absolutely no halftone dots, no comic style, no lightning bolts, no bursts, no glow or neon bloom, no lens flare, no sparkles,
no text, letters or numbers, no logos, no people, no creatures or characters, no trading cards, no card packs.`;

const STAGE = {
  baseball: "Subject: an extreme close-up of worn brown baseball leather with one curved red seam stitch running along the bottom edge only. Darkened, moody, most of the frame is smooth dark leather.",
  football: "Subject: dark green turf seen from low and close, with a single soft white yard line crossing near the bottom of the frame. Darkened, calm, most of the frame is plain dark turf.",
  pokemon: "Subject: a flat, smooth deep violet surface with one soft warm arcade light falling gently from the top edge, fading into darkness. Abstract and minimal, nothing else in the frame.",
};

const SCENE = Object.fromEntries(
  Object.entries(STAGE).map(([c, sub]) => [
    `stage-${c}`,
    {
      ratio: "4:5",
      out: "webp",
      width: 900,
      prompt: `${LOOK}\n${sub}\nThis is a backdrop for a product photo: full-bleed, edge to edge, the centre must be calm and empty so an object can sit there. Strictly no text.`,
    },
  ]),
);

async function scene(name, { recut = false } = {}) {
  const s = SCENE[name] ?? PACKS[name];
  if (!s) throw new Error(`unknown scene ${name}`);
  const raw = path.join(RAW, `${name}.png`);
  if (!recut) await generateScene(name, s, raw);
  await finishScene(name, s, raw);
}

async function generateScene(name, s, raw) {
  const j = await api(`${API}/models/${IMAGE_MODEL}:generateContent`, {
    contents: [{ role: "user", parts: [{ text: s.prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: s.ratio } },
  });
  const part = (j.candidates ?? []).flatMap((c) => c.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part) throw new Error(`${name}: no image in ${JSON.stringify(j).slice(0, 300)}`);
  writeFileSync(raw, Buffer.from(part.inlineData.data, "base64"));
}

/** lib/brandScenes.json: the scenes that exist in public/brand. The site shows only these (missing = plain navy block). */
function writeManifest() {
  const have = Object.entries(SCENE).filter(([n, s]) => existsSync(path.join(OUT, `${n}.${s.out}`))).map(([n, s]) => [n, `/brand/${n}.${s.out}`]);
  writeFileSync(path.resolve("lib/brandScenes.json"), JSON.stringify(Object.fromEntries(have), null, 2) + "\n");
  console.log("manifest", have.length, "scenes");
}

async function finishScene(name, s, raw) {
  const vf = [];
  if (s.crop) vf.push(`crop=iw:ih*${s.crop}:0:(ih-ih*${s.crop})/2`); // a short header strip from the middle
  vf.push(`scale=${s.width}:-2`);
  const out = path.join(OUT, `${name}.${s.out}`);
  if (s.key) {
    // Key out the green screen, then trim the empty margin around the sticker (box found on the alpha plane).
    const keyed = path.join(RAW, `${name}-keyed.png`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", "colorkey=0x00FF00:0.32:0.08,despill=type=green", "-pix_fmt", "rgba", keyed]);
    // Trim the empty margin on the alpha plane, then scale (sharp, so every pack fills its frame the same way).
    await sharp(keyed).trim({ threshold: 1 }).resize({ width: s.width }).webp({ quality: 90, alphaQuality: 90 }).toFile(out);
  } else {
    const args = ["-y", "-loglevel", "error", "-i", raw, "-vf", vf.join(",")];
    if (s.out === "webp") args.push("-quality", "82");
    execFileSync("ffmpeg", [...args, out]);
  }
  console.log("scene", name);
}

const [cmd, ...names] = process.argv.slice(2);
if (cmd === "packs") {
  for (const n of names.length ? names : Object.keys(PACKS)) await scene(n).catch((e) => console.error(`pack ${n} failed: ${e.message}`));
} else if (cmd === "scenes-manifest") {
  writeManifest();
} else if (cmd === "scenes-recut") {
  for (const n of names.length ? names : [...Object.keys(SCENE), ...Object.keys(PACKS)]) if (existsSync(path.join(RAW, `${n}.png`))) await scene(n, { recut: true });
  writeManifest();
} else if (cmd === "scenes") {
  // One failure never stops the rest: the page keeps its plain navy block for anything missing.
  for (const n of names.length ? names : Object.keys(SCENE))
    await scene(n).catch((e) => console.error(`scene ${n} failed: ${e.message}`));
  writeManifest();
} else console.log("usage: node scripts/gemini-art.mjs packs [name...] | scenes [name...] | scenes-recut [name...] | scenes-manifest");
