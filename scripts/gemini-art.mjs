#!/usr/bin/env node
/**
 * Brand art and animations for the shop, made with Gemini (images) and Veo (video), then trimmed with ffmpeg
 * into small static files in public/brand/. Run by hand when the art should change; the site never calls Gemini.
 *
 *   GEMINI_API_KEY=... node scripts/gemini-art.mjs images            # 6 stills: sealed + torn pack per category
 *   GEMINI_API_KEY=... node scripts/gemini-art.mjs videos [name...]   # clips (tear-*, pass-*, hit), from the stills
 *   node scripts/gemini-art.mjs encode                                # re-cut the saved raw clips (no Gemini call)
 *   GEMINI_API_KEY=... node scripts/gemini-art.mjs scenes [name...]   # pack stages, page headers, title treatments, pattern
 *   node scripts/gemini-art.mjs scenes-recut [name...]                # re-crop/re-encode saved scene PNGs (no Gemini call)
 *
 * Text prompts only (plus our own generated stills as the first video frame). Never card photos.
 * No league, Pokemon, Nintendo or Disney characters or logos, no text. Brand palette only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY && !["encode", "scenes-recut", "scenes-manifest"].includes(process.argv[2])) throw new Error("Set GEMINI_API_KEY");
const OUT = path.resolve("public/brand");
const RAW = path.resolve(process.env.ART_RAW_DIR || ".art-raw");
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });
const API = "https://generativelanguage.googleapis.com/v1beta";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-fast-generate-preview";

const BRAND = `Brand: "Trade Shark", a small, friendly trading card shop. Its mark is a simple geometric shark fin: a flat teal (#1AA6A6) triangle fin with a thin coral (#E85D4C) waterline bar under it.
Palette only: navy #0B1F3A, teal #1AA6A6, sand #F4EFE6, a touch of coral #E85D4C, white. Polished flat-vector illustration with soft lighting and a subtle foil sheen.
Strictly no text, letters or numbers anywhere. No Pokemon, Nintendo, Disney or sports league or team logos, no mascots or characters, no real trading card art.`;

const THEME = {
  baseball: "Theme: baseball. A subtle pattern of curved baseball seam stitching in coral and sand across the navy foil.",
  football: "Theme: football. Subtle sand yard-line stripes and a row of lace stitching across the navy foil.",
  pokemon: "Theme: a creature-collector card game. Soft glowing teal energy orbs and small coral lightning sparks across the navy foil. No creatures.",
};

const PACK = (cat) => `${BRAND}
${THEME[cat]}
Draw one sealed foil trading-card booster pack, front view, standing upright and centered, portrait 3:4.
The pack is navy with a sand stripe across the middle and the teal geometric shark fin mark large in the center. Crimped foil seals at top and bottom.
Plain solid navy #0B1F3A background, generous empty space around the pack.`;

const OPEN = (cat) => `${BRAND}
${THEME[cat]}
Draw the same trading-card booster pack just torn open: the crimped top strip is ripped off along a jagged tear and hangs to one side,
the pack is empty inside, a few teal and coral paper confetti bits in the air. Navy pack, sand stripe, teal geometric shark fin mark.
Front view, centered, portrait 3:4, plain solid navy #0B1F3A background.`;

async function api(url, body) {
  const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

async function image(name, prompt) {
  const j = await api(`${API}/models/${IMAGE_MODEL}:generateContent`, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
  });
  const part = (j.candidates ?? []).flatMap((c) => c.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part) throw new Error(`${name}: no image in ${JSON.stringify(j).slice(0, 300)}`);
  const raw = path.join(RAW, `${name}.png`);
  writeFileSync(raw, Buffer.from(part.inlineData.data, "base64"));
  // 720 px tall WebP: crisp on a phone, small on the wire.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", "scale=-2:720", "-quality", "88", path.join(OUT, `${name}.webp`)]);
  console.log("image", name);
}

/** Where the action starts and how long to keep, per clip (Veo opens with a still beat we don't need). */
const CUTS = {
  "tear-baseball": [1.2, 2.4],
  "tear-football": [0.9, 2.4],
  "tear-pokemon": [0.8, 2.4],
  // Veo brings the pack back after the puff: cut while it's still smoke.
  "pass-baseball": [0.9, 1.8],
  "pass-football": [0.8, 1.6],
  "pass-pokemon": [0.9, 1.6],
  hit: [0.3, 1.8], // the burst never fades on its own; the page fades it

  default: [0, 3.2],
};

function encode(name) {
  const raw = path.join(RAW, `${name}.mp4`);
  const [ss, t] = CUTS[name] ?? CUTS.default;
  // Crop 9:16 to the pack's 3:4, 480 px wide, muted, short, web-ready (H.264 + fast start).
  const vf = "crop=iw:iw*4/3,scale=480:-2,fps=30";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(ss), "-i", raw, "-t", String(t), "-an", "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(OUT, `${name}.mp4`)]);
  // VP9 WebM too, for browsers without H.264. The hit burst is drawn on black: its brightness becomes its alpha,
  // so it sits on top of the cards with no box (the MP4 stays opaque and is screen-blended instead).
  const alpha = name === "hit";
  const wvf = alpha ? `${vf},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(255,1.8*max(r(X,Y),max(g(X,Y),b(X,Y))))'` : vf;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(ss), "-i", raw, "-t", String(t), "-an", "-vf", wvf, "-c:v", "libvpx-vp9", ...(alpha ? ["-pix_fmt", "yuva420p", "-auto-alt-ref", "0"] : []), "-b:v", "0", "-crf", "38", "-row-mt", "1", path.join(OUT, `${name}.webm`)]);
}

async function video(name, prompt, firstFrame, { seconds = 4 } = {}) {
  const instance = { prompt };
  if (firstFrame) instance.image = { bytesBase64Encoded: readFileSync(firstFrame).toString("base64"), mimeType: "image/png" };
  let op = await api(`${API}/models/${VIDEO_MODEL}:predictLongRunning`, { instances: [instance], parameters: { aspectRatio: "9:16", durationSeconds: seconds } });
  process.stdout.write(`video ${name} ${op.name} `);
  while (!op.done) {
    await new Promise((r) => setTimeout(r, 8000));
    op = await api(`${API}/${op.name}`);
    process.stdout.write(".");
  }
  if (op.error) throw new Error(`${name}: ${JSON.stringify(op.error)}`);
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error(`${name}: no video in ${JSON.stringify(op.response).slice(0, 300)}`);
  const r = await fetch(uri, { headers: { "x-goog-api-key": KEY }, redirect: "follow" });
  if (!r.ok) throw new Error(`${name}: download ${r.status}`);
  writeFileSync(path.join(RAW, `${name}.mp4`), Buffer.from(await r.arrayBuffer()));
  encode(name);
  console.log(" ok");
}

const CATS = ["baseball", "football", "pokemon"];
const VIDEOS = {
  ...Object.fromEntries(
    CATS.map((c) => [
      `tear-${c}`,
      () =>
        video(
          `tear-${c}`,
          `The sealed booster pack in this image gets torn open from the top in one quick, satisfying rip. A bright teal and white light bursts out of the opening and a few teal and coral paper confetti pieces pop out. The camera stays still, front view, plain navy #0B1F3A background. Flat illustrated style matching the image. No text, no characters, no cards visible.`,
          path.join(RAW, `pack-${c}.png`),
        ),
    ]),
  ),
  ...Object.fromEntries(
    CATS.map((c) => [
      `pass-${c}`,
      () =>
        video(
          `pass-${c}`,
          `The booster pack in this image gently shrinks and dissolves into a soft puff of teal smoke and tiny sparkles that drift away, leaving only the plain navy #0B1F3A background. Calm, quick, a little playful. Camera still. Flat illustrated style. No text, no characters.`,
          path.join(RAW, `pack-${c}.png`),
        ),
    ]),
  ),
  hit: () =>
    video(
      "hit",
      `A celebratory burst on a pure black background: teal and coral sparkles and thin light rays shoot outward from the center, a few small shimmering stars twinkle, then fade. Flat graphic motion design, festive, centered, no objects, no text, no characters. Pure black #000000 background throughout.`,
      null,
    ),
};


/* ------------------------------------------------------------------ scenes: stages, headers, titles, pattern */

// Card-shop hype, not a bank. Navy, cream, gold, one sport accent per category. Rough print texture, no AI glow.
const LOOK = `Style: loud, fun, slightly rough hand-made card-shop art. Screen-printed and painted look with visible ink texture,
halftone dots, slight misregistration, chunky shapes. Palette: deep navy #0B1F3A, warm cream #F4EFE6, metallic gold #D9A441, plus the one accent named below.
Absolutely no smooth stock gradients, no generic glowing AI light blooms, no lens flares, no floating UI shapes, no bokeh.
No people, no mascots, no creatures, no characters, no logos of any league, team, Pokemon, Nintendo or Disney. No trading cards, no card packs.`;

const STAGE = {
  baseball: "Accent: oxblood red #9E2B25. Subject: a worn leather baseball glove pocket and well-used ball leather filling the frame like a backdrop, thick red lace stitching curving around the edges, scuffs and dust, warm stadium-light spill from the top.",
  football: "Accent: turf green #2F7D3A. Subject: a close, low view of a football field turf filling the frame, chalky cream yard lines and hash marks running across, a gold goal-post shape far in the background, rough painted grass texture.",
  pokemon: "Accent: electric yellow #FFD23F with a little cyan #3FD0E0. Subject: an old arcade cabinet interior lit up: chunky pixel grid, zig-zag lightning bolts, scanlines and halftone bursts filling the frame, loud and electric. Abstract shapes only, no creatures.",
};

const SCENE = {
  ...Object.fromEntries(
    Object.entries(STAGE).map(([c, sub]) => [
      `stage-${c}`,
      {
        ratio: "4:5",
        out: "webp",
        width: 900,
        prompt: `${LOOK}\n${sub}\nThis is a stage backdrop: full-bleed, edge to edge, the busy texture lives around the edges and corners. Keep a calm, darker navy area in the middle third (an object will be placed there later), so the center stays quiet and readable. Strictly no text, letters or numbers anywhere.`,
      },
    ]),
  ),
  "header-packs": {
    ratio: "21:9",
    out: "webp",
    width: 1600,
    crop: 0.42,
    prompt: `${LOOK}\nAccent: all three at once in bands: oxblood red #9E2B25 stitched leather on the left, turf green #2F7D3A yard lines in the middle, electric yellow #FFD23F lightning on the right, blended into one long, low banner of a card-shop counter wall. Wide and short. Keep the middle band darker navy so a title can sit on it. Strictly no text, letters or numbers.`,
  },
  "header-collection": {
    ratio: "21:9",
    out: "webp",
    width: 1600,
    crop: 0.42,
    prompt: `${LOOK}\nAccent: gold #D9A441. Subject: a long, low shelf of a collector's den seen straight on: stacked card boxes as plain unlabeled cream and navy blocks, binders spines with no lettering, a gold trophy shape, tape and stickers. Wide and short, the middle stays calmer navy for a title. Strictly no text, letters or numbers.`,
  },
  "header-consign": {
    ratio: "21:9",
    out: "webp",
    width: 1600,
    crop: 0.42,
    prompt: `${LOOK}\nAccent: gold #D9A441. Subject: a long, low banner of plain cardboard shipping boxes and padded mailers piled up, packing tape, a postal stamp shape with no lettering, string. Wide and short, the middle stays calmer navy for a title. Strictly no text, letters or numbers.`,
  },
  "title-pick": {
    ratio: "21:9",
    out: "webp",
    key: true,
    width: 900,
    prompt: `${LOOK}\nA bold title treatment of exactly these words: "Pick a pack." (spelled exactly that, with the period). Make it look like a thick die-cut vinyl sticker: chunky hand-painted cream letters with a navy outline, a fat gold offset shadow and a white sticker border around the whole word group, slightly tilted, a little scuffed. The only text in the image is "Pick a pack." Place it on a perfectly flat, pure solid green #00FF00 background with nothing else on it.`,
  },
  "title-tradeshark": {
    ratio: "21:9",
    out: "webp",
    key: true,
    width: 900,
    prompt: `${LOOK}\nA bold title treatment of exactly this word: "TradeShark" (one word, capital T and capital S). Hand-painted sign-shop lettering in cream with a navy outline and a gold drop shadow, like a die-cut sticker with a white border, plus a simple flat navy shark fin triangle tucked at the right end. The only text in the image is "TradeShark". Place it on a perfectly flat, pure solid green #00FF00 background with nothing else on it.`,
  },
  pattern: {
    ratio: "1:1",
    out: "webp",
    width: 240,
    prompt: `${LOOK}\nA seamless repeating tile pattern on a flat warm cream #F4EFE6 background: small scattered navy and gold doodles of shark fins, baseball stitch marks, little yard-line dashes and tiny lightning bolts, low contrast, evenly spaced so it tiles on all edges. Flat, no shading. Strictly no text, letters or numbers.`,
  },
};

async function scene(name, { recut = false } = {}) {
  const s = SCENE[name];
  if (!s) throw new Error(`unknown scene ${name}`);
  const raw = path.join(RAW, `${name}.png`);
  if (!recut) await generateScene(name, s, raw);
  finishScene(name, s, raw);
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

function finishScene(name, s, raw) {
  const vf = [];
  if (s.crop) vf.push(`crop=iw:ih*${s.crop}:0:(ih-ih*${s.crop})/2`); // a short header strip from the middle
  vf.push(`scale=${s.width}:-2`);
  const out = path.join(OUT, `${name}.${s.out}`);
  if (s.key) {
    // Key out the green screen, then trim the empty margin around the sticker (box found on the alpha plane).
    const keyed = path.join(RAW, `${name}-keyed.png`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", "colorkey=0x00FF00:0.32:0.08,despill=type=green", "-pix_fmt", "rgba", keyed]);
    const log = spawnSync("ffmpeg", ["-i", keyed, "-vf", "alphaextract,cropdetect=limit=16:round=2:reset=0", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const box = [...String(log).matchAll(/crop=(\d+:\d+:\d+:\d+)/g)].pop()?.[1];
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", keyed, "-vf", `${box ? `crop=${box},` : ""}scale=${s.width}:-2`, "-quality", "90", "-pix_fmt", "yuva420p", out]);
  } else {
    const args = ["-y", "-loglevel", "error", "-i", raw, "-vf", vf.join(",")];
    if (s.out === "webp") args.push("-quality", "82");
    execFileSync("ffmpeg", [...args, out]);
  }
  console.log("scene", name);
}

const [cmd, ...names] = process.argv.slice(2);
if (cmd === "images") {
  for (const c of CATS) {
    await image(`pack-${c}`, PACK(c));
    await image(`open-${c}`, OPEN(c));
  }
} else if (cmd === "videos") {
  for (const n of names.length ? names : Object.keys(VIDEOS)) {
    if (!VIDEOS[n]) throw new Error(`unknown video ${n}`);
    if (n !== "hit" && !existsSync(path.join(RAW, `pack-${n.split("-")[1]}.png`))) throw new Error(`run images first (${n})`);
    await VIDEOS[n]();
  }
} else if (cmd === "encode") {
  for (const n of Object.keys(VIDEOS)) if (existsSync(path.join(RAW, `${n}.mp4`))) (encode(n), console.log("encoded", n));
} else if (cmd === "scenes-manifest") {
  writeManifest();
} else if (cmd === "scenes-recut") {
  for (const n of names.length ? names : Object.keys(SCENE)) if (existsSync(path.join(RAW, `${n}.png`))) await scene(n, { recut: true });
  writeManifest();
} else if (cmd === "scenes") {
  // One failure never stops the rest: the page keeps its plain navy block for anything missing.
  for (const n of names.length ? names : Object.keys(SCENE))
    await scene(n).catch((e) => console.error(`scene ${n} failed: ${e.message}`));
  writeManifest();
} else console.log("usage: node scripts/gemini-art.mjs images | videos [name...] | encode | scenes [name...]");
