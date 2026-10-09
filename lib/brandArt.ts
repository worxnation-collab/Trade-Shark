import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { dataDir } from "./env";
import { getObject, putObject, signedUrl, usingSupabase } from "./storage";

/**
 * Lil' Stack pack art, generated once with Gemini and cached.
 * - The prompt is text only. Card photos are never sent.
 * - GEMINI_API_KEY is read on the server only; without it the shop draws the CSS pack instead.
 * - Cache: DATA_DIR/brand locally, `brand/` in the private bucket on Netlify. A Setting row says what exists.
 */
export const ART_KINDS = ["closed", "open"] as const;
export type ArtKind = (typeof ART_KINDS)[number];

const SETTING_KEY = "brand-art";
const BRAND = `Brand: "Trade Shark", a small card shop. Its mark is a simple geometric shark fin: a flat teal (#1AA6A6) triangle fin with a thin coral (#E85D4C) waterline bar under it.
Palette only: navy #0B1F3A, teal #1AA6A6, sand #F4EFE6, a touch of coral #E85D4C, white. Flat vector illustration, crisp edges, soft studio shadow.
Strictly no text or lettering, no Pokemon, Nintendo, Disney or sports league logos, no characters, no real trading card art.`;

const PROMPTS: Record<ArtKind, string> = {
  closed: `${BRAND}
Draw one sealed foil trading-card booster pack, front view, standing upright and centered, portrait 3:4.
The pack is navy with a sand stripe across the middle and the teal geometric shark fin mark large in the center. Crimped foil seals at top and bottom.
Plain solid navy #0B1F3A background with a little empty space around the pack.`,
  open: `${BRAND}
Draw the same trading-card booster pack just torn open: the crimped top strip is ripped off along a jagged tear and hangs to one side,
the pack is empty inside, a few teal and coral paper confetti bits in the air. Navy pack, sand stripe, teal geometric shark fin mark.
Front view, centered, portrait 3:4, plain solid navy #0B1F3A background.`,
};

type ArtIndex = Partial<Record<ArtKind, { rel: string; mime: string; at: string }>>;

export function geminiConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

export async function artIndex(): Promise<ArtIndex> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    return row ? (JSON.parse(row.value) as ArtIndex) : {};
  } catch {
    return {};
  }
}

/** Public URLs for whichever images are cached (cache-busted by generation time). */
export async function artUrls(): Promise<Partial<Record<ArtKind, string>>> {
  const idx = await artIndex();
  const out: Partial<Record<ArtKind, string>> = {};
  for (const k of ART_KINDS) if (idx[k]) out[k] = `/api/shop/brand/${k}?v=${Date.parse(idx[k]!.at) || 0}`;
  return out;
}

const localBrandDir = () => path.resolve(process.cwd(), dataDir(), "brand");

async function store(kind: ArtKind, buf: Uint8Array, mime: string) {
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const rel = `brand/lil-stack-${kind}.${ext}`;
  if (usingSupabase()) await putObject(rel, buf, mime);
  else {
    await mkdir(localBrandDir(), { recursive: true });
    await writeFile(path.join(localBrandDir(), path.basename(rel)), buf);
  }
  const idx = await artIndex();
  idx[kind] = { rel, mime, at: new Date().toISOString() };
  const value = JSON.stringify(idx);
  await db.setting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  return idx[kind]!;
}

/** Bytes for the local route, or a signed URL on Supabase. */
export async function readArt(kind: ArtKind): Promise<{ url: string } | { buf: Uint8Array; mime: string } | null> {
  const meta = (await artIndex())[kind];
  if (!meta) return null;
  if (usingSupabase()) {
    const url = await signedUrl(meta.rel, 3600);
    return url ? { url } : null;
  }
  try {
    return { buf: new Uint8Array(await readFile(path.join(localBrandDir(), path.basename(meta.rel)))), mime: meta.mime };
  } catch {
    const buf = await getObject(meta.rel);
    return buf ? { buf, mime: meta.mime } : null;
  }
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

/** Generate one image with Gemini and cache it. Fails soft with a reason. */
export async function generateArt(kind: ArtKind): Promise<{ ok: true; at: string } | { ok: false; reason: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "GEMINI_API_KEY not set — the shop uses the CSS pack." };
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPTS[kind] }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
      }),
      signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 24000)),
    });
    if (!res.ok) return { ok: false, reason: `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const json = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
    const parts = json.candidates?.flatMap((c) => c.content?.parts ?? []) ?? [];
    const img = parts.map((p) => p.inlineData ?? (p.inline_data && { mimeType: p.inline_data.mime_type, data: p.inline_data.data })).find((d) => d?.data);
    if (!img?.data) return { ok: false, reason: "Gemini returned no image." };
    const meta = await store(kind, new Uint8Array(Buffer.from(img.data, "base64")), img.mimeType || "image/png");
    return { ok: true, at: meta.at };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
