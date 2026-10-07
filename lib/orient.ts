import Anthropic from "@anthropic-ai/sdk";
import type { Card } from "@prisma/client";
import path from "node:path";
import sharp from "sharp";
import { db } from "./db";
import { keys } from "./env";
import { readStored } from "./images";
import { putObject } from "./storage";

/**
 * Upright every card on upload, before identify/price/publish. No "Rotate all" button needed.
 * - A card is taller than wide: a landscape crop gets a quarter turn; a portrait one may still be upside down.
 * - Direction comes from the vision model when ANTHROPIC_API_KEY is set, else a layout guess
 *   (busy art/name area at the top, text box and number at the bottom).
 * - The fixed image is saved over the crop (front and its back, same turn). The original is kept only for a guess.
 * - Each crop is turned on its own, never the whole sheet.
 * - Still sideways (or a weak guess on a sideways crop) → holdReason "rotation", so it waits in Needs a look.
 */
export type Deg = 0 | 90 | 180 | 270;
/** The layout cue is weak on real cards (full art, foreign printings): it only ever counts as a guess. */
export const LAYOUT_SURE = 0.3;

export interface Orientation {
  deg: Deg;
  how: "vision" | "layout guess";
  /** The model was confident, or the layout cue was strong. */
  sure: boolean;
  margin?: number;
  /** The layout cue says a portrait card may be upside down: don't guess, ask for a one-tap rotate. */
  suspect?: boolean;
}

const isLandscape = (w: number, h: number) => w > h * 1.05;
const norm = (d: number) => ((((Math.round(d / 90) * 90) % 360) + 360) % 360) as Deg;

/**
 * Layout cue, > 0 when the busy part (art window, name band) sits in the upper half and the calmer
 * text box sits below: how a Pokémon, Magic or sports card looks upright. Range about -1..1.
 */
export async function topHeavy(buf: Uint8Array): Promise<number> {
  const W = 48;
  const H = 64;
  const { data } = await sharp(buf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const row = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      // Detail: difference to the right and below (art is busy, text boxes are flat).
      const j = x + 1 < W ? i + 3 : i;
      const k = y + 1 < H ? i + W * 3 : i;
      const lum = (p: number) => 0.3 * data[p] + 0.59 * data[p + 1] + 0.11 * data[p + 2];
      const detail = Math.abs(lum(i) - lum(j)) + Math.abs(lum(i) - lum(k));
      sum += chroma * 0.5 + detail;
    }
    row[y] = sum / W;
  }
  const band = (a: number, b: number) => row.slice(Math.round(a * H), Math.round(b * H)).reduce((s, v) => s + v, 0);
  const top = band(0.06, 0.5);
  const bottom = band(0.5, 0.94);
  return (top - bottom) / (top + bottom + 1e-6);
}

/** No vision key: pick the turn from the layout cue. Always counts as a guess. */
export async function layoutGuess(buf: Uint8Array, landscape: boolean): Promise<Orientation> {
  if (landscape) {
    const s = await topHeavy(await sharp(buf).rotate(90).toBuffer());
    return { deg: s >= 0 ? 90 : 270, how: "layout guess", sure: Math.abs(s) >= LAYOUT_SURE, margin: Math.abs(s) };
  }
  // Portrait stays as scanned without vision (the cue flipped upright cards too often), but a strong
  // "upside down" cue is flagged for a one-tap check instead of being trusted either way.
  const s = await topHeavy(buf);
  return { deg: 0, how: "layout guess", sure: true, margin: Math.abs(s), suspect: s <= -LAYOUT_SURE };
}

const ORIENT_PROMPT = `This is a scan crop of ONE trading card (Pokemon, sports, etc.), possibly rotated by 90, 180 or 270 degrees.
Upright means: the card name and HP are at the top, the artwork is under the name, and the attack or rules text is below the artwork.
For a full-art card: the illustration reads top to bottom and the small set number sits in a bottom corner.
Energy and Trainer cards follow the same rule (title at the top). Cards may be in English, Japanese or Chinese.
Ignore holo foil patterns and sparkles; judge only by the printed text and layout.
Which edge of THIS IMAGE is the top of the card (where the name is printed)? Answer top, right, bottom or left.
Set sure=false if you cannot tell.`;

const ORIENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["card_top_edge", "sure"],
  properties: { card_top_edge: { type: "string", enum: ["top", "right", "bottom", "left"] }, sure: { type: "boolean" } },
};

/** Card top at the image's right edge → turn 90° counter-clockwise (270 clockwise), and so on. */
export const TURN_FOR_TOP: Record<string, Deg> = { top: 0, right: 270, bottom: 180, left: 90 };

async function askTopEdge(client: Anthropic, model: string, buf: Uint8Array) {
  const small = await sharp(buf).resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const params = {
    model,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: ORIENT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } },
          { type: "text", text: ORIENT_PROMPT },
        ],
      },
    ],
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b <= a) continue; // empty answer: ask once more
    const j = JSON.parse(text.slice(a, b + 1)) as { card_top_edge: string; sure: boolean };
    if (j.card_top_edge in TURN_FOR_TOP) return { deg: TURN_FOR_TOP[j.card_top_edge], sure: !!j.sure };
  }
  return null;
}

/**
 * Ask the vision model which edge is the card's top, turn it, then ask again on the turned image.
 * A second answer of "top" confirms it; otherwise one more correction, and it only counts as sure if that
 * one is confirmed too. Returns null when there's no key or the calls fail (the layout guess takes over).
 */
export async function visionOrientation(buf: Uint8Array): Promise<Orientation | null> {
  const { anthropic, anthropicModel } = keys();
  if (!anthropic) return null;
  try {
    const client = new Anthropic({ apiKey: anthropic, timeout: Number(process.env.ORIENT_TIMEOUT_MS || 15000), maxRetries: 1 });
    const model = process.env.ORIENT_MODEL || anthropicModel;
    const first = await askTopEdge(client, model, buf);
    if (!first) return null;
    if (first.deg === 0) return { deg: 0, how: "vision", sure: first.sure };
    let total: Deg = first.deg;
    for (let check = 0; check < 2; check++) {
      const turned = await sharp(buf).rotate(total).toBuffer();
      const again = await askTopEdge(client, model, turned);
      if (!again) return { deg: total, how: "vision", sure: false };
      if (again.deg === 0) return { deg: total, how: "vision", sure: first.sure && again.sure };
      total = norm(total + again.deg);
    }
    return { deg: total, how: "vision", sure: false };
  } catch (e) {
    console.error("orientation vision call failed", e);
    return null;
  }
}

/**
 * What to do with one crop: the turn, whether it's a guess, and whether it needs a person (`sideways`: held for a
 * one-tap rotate). Held: still landscape after the turn, a coin-flip turn of a sideways crop, an unsure vision
 * answer, or a portrait card the layout cue thinks is upside down. Never published on a guess that could be wrong.
 */
export function plan(o: Orientation, landscape: boolean) {
  const guess = o.how !== "vision" || !o.sure;
  const quarter = o.deg === 90 || o.deg === 270;
  const stillLandscape = quarter ? !landscape : landscape;
  const sideways = stillLandscape || (landscape && guess && !o.sure) || (o.how === "vision" && !o.sure) || !!o.suspect;
  return { guess, sideways };
}

async function rotateStored(rel: string, deg: Deg, keepOriginal: boolean) {
  const img = await readStored(rel);
  if (!img) return { original: null as string | null };
  let original: string | null = null;
  if (keepOriginal) {
    original = path.posix.join(path.posix.dirname(rel), "orig", path.posix.basename(rel));
    await putObject(original, img.buf, img.mime);
  }
  const s = sharp(img.buf).rotate().rotate(deg); // bake EXIF, then the turn
  const out = img.mime === "image/png" ? await s.png().toBuffer() : await s.jpeg({ quality: 92 }).toBuffer();
  await putObject(rel, new Uint8Array(out), img.mime === "image/png" ? "image/png" : "image/jpeg");
  return { original };
}

/** Orient one card in place. Idempotent: a card is only ever oriented once (orientedAt). */
export async function orientCard(card: Card): Promise<Card> {
  if (card.orientedAt || !card.readable || !card.frontImage) return card;
  const img = await readStored(card.frontImage);
  if (!img) return db.card.update({ where: { id: card.id }, data: { orientedAt: new Date(), rotationNote: "no image" } });
  const upright = await sharp(img.buf).rotate().toBuffer({ resolveWithObject: true });
  const landscape = isLandscape(upright.info.width, upright.info.height);

  let o = await visionOrientation(upright.data);
  if (!o) o = await layoutGuess(upright.data, landscape);
  const { guess, sideways } = plan(o, landscape);

  let frontOriginal: string | null = null;
  let backOriginal: string | null = null;
  if (o.deg !== 0) {
    frontOriginal = (await rotateStored(card.frontImage, o.deg, guess)).original;
    if (card.backImage) backOriginal = (await rotateStored(card.backImage, o.deg, guess)).original;
  }
  return db.card.update({
    where: { id: card.id },
    data: {
      orientedAt: new Date(),
      rotation: o.deg,
      rotationNote: sideways ? "unsure" : o.deg === 0 ? "upright" : o.how,
      frontOriginal,
      backOriginal,
      frontDisplay: o.deg !== 0 ? null : card.frontDisplay, // the framed copy is rebuilt from the turned scan
      holdReason: sideways ? "rotation" : card.holdReason === "rotation" ? null : card.holdReason,
    },
  });
}

/**
 * Re-check a card scanned before auto-rotate existed (or one I want checked again): same rules as on ingest.
 * Unsure → held in Needs a look for a one-tap rotate. A card in a pack or sold is never touched.
 */
export async function reorientCard(card: Card) {
  if (!["Inbox", "Identified", "Priced", "BulkHold", "NeedsLook"].includes(card.status)) return card;
  const done = await orientCard({ ...card, orientedAt: null });
  if (done.holdReason === "rotation" && done.status !== "NeedsLook") return db.card.update({ where: { id: card.id }, data: { status: "NeedsLook", location: null, sortedAt: null } });
  return done;
}

/**
 * The one-tap fix: turn a card by hand (front and back together, saved in place), or `deg` 0 = "it's upright".
 * Clears the rotation hold; a card that was only waiting on its rotation goes back to stock under the usual $5 rule.
 */
export async function turnCard(card: Card, deg: Deg) {
  if (!card.frontImage) return card;
  if (deg !== 0) {
    await rotateStored(card.frontImage, deg, false);
    if (card.backImage) await rotateStored(card.backImage, deg, false);
  }
  const wasRotationHold = card.holdReason === "rotation";
  const updated = await db.card.update({
    where: { id: card.id },
    // The display image is rebuilt from the turned scan the next time it's needed.
    data: {
      rotation: norm(card.rotation + deg),
      rotationNote: deg === 0 ? "checked upright" : "by hand",
      holdReason: wasRotationHold ? null : card.holdReason,
      ...(deg !== 0 ? { frontDisplay: null, location: null, sortedAt: null } : {}),
    },
  });
  if (wasRotationHold && updated.status === "NeedsLook" && updated.listPrice != null && updated.listPrice <= 5 && (updated.name || updated.player))
    return db.card.update({ where: { id: card.id }, data: { status: "Priced", confirmedAt: updated.confirmedAt ?? new Date() } });
  return updated;
}
