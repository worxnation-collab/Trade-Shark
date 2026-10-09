import sharp from "sharp";
import { readStored } from "./images";
import { putObject } from "./storage";

/**
 * The real scan, presented as a finished card for a phone: straighten a small skew, trim the scanner background,
 * then lay it on a crisp rounded border with a thin inner edge and a soft shadow. The scan itself is never blurred,
 * sharpened into something else, or redrawn: only rotated (when skewed), cropped, scaled down, and corner-masked.
 */
export const DISPLAY_MAX = 900; // long edge of the scan inside the frame, px (never upscaled)
const MAX_SKEW = 10; // degrees; more than this is a rotation problem, not a skew
const MIN_SKEW = 0.4;

/** Median color of the outer 2% ring: the scanner background (or the card edge on a tight crop). */
async function edgeColor(img: ReturnType<typeof sharp>) {
  const { data, info } = await img.clone().removeAlpha().resize(200, 200, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const r: number[] = [], g: number[] = [], b: number[] = [];
  const ring = 4;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (x >= ring && y >= ring && x < info.width - ring && y < info.height - ring) continue;
      const i = (y * info.width + x) * 3;
      r.push(data[i]);
      g.push(data[i + 1]);
      b.push(data[i + 2]);
    }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return { r: med(r), g: med(g), b: med(b) };
}

/**
 * Skew of the card (degrees, clockwise positive) from everything that isn't background, plus how much of the
 * frame the card fills. A crop that's almost all card has nothing to measure: 0.
 */
export async function measureSkew(buf: Buffer | Uint8Array): Promise<{ deg: number; fill: number }> {
  const img = sharp(buf).rotate();
  const bg = await edgeColor(img);
  const { data, info } = await img.clone().removeAlpha().resize(256, 256, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  const pts: number[] = [];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      const d = Math.abs(data[i] - bg.r) + Math.abs(data[i + 1] - bg.g) + Math.abs(data[i + 2] - bg.b);
      if (d > 60) {
        n++;
        pts.push(x, y);
      }
    }
  const fill = n / (info.width * info.height);
  if (n < 50 || fill > 0.9) return { deg: 0, fill };
  // The card is the rectangle: its outline gives the tightest bounding box when it's square to the frame.
  // Search ±MAX_SKEW coarse, then refine (the artwork inside doesn't bias this the way image moments do).
  const area = (deg: number) => {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k] * c - pts[k + 1] * sn, y = pts[k] * sn + pts[k + 1] * c;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return (x1 - x0) * (y1 - y0);
  };
  let best = 0, bestA = area(0);
  for (let d = -MAX_SKEW; d <= MAX_SKEW; d += 0.5) {
    const a = area(d);
    if (a < bestA - 1e-6) [best, bestA] = [d, a];
  }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) {
    const a = area(d);
    if (a < bestA - 1e-6) [best, bestA] = [d, a];
  }
  // area(d) is smallest when rotating the points by d squares the card, i.e. the card is tilted by -d.
  return { deg: -Math.round(best * 10) / 10, fill };
}

/** Build the presentation image (PNG with transparency) from a stored scan. */
export async function presentScan(buf: Buffer | Uint8Array): Promise<Buffer> {
  let img = sharp(buf).rotate();
  const bg = await edgeColor(img);
  const { deg, fill } = await measureSkew(buf);
  let work = await img.toBuffer();
  if (Math.abs(deg) >= MIN_SKEW && Math.abs(deg) <= MAX_SKEW) work = await sharp(work).rotate(-deg, { background: { ...bg, alpha: 1 } }).toBuffer();
  // Trim the scanner background (only when there is some: a tight crop is left alone).
  if (fill <= 0.9) {
    try {
      work = await sharp(work).trim({ background: { ...bg, alpha: 1 }, threshold: 40 }).toBuffer();
    } catch {
      /* nothing to trim */
    }
  }
  img = sharp(work);
  const meta = await img.metadata();
  const scale = Math.min(1, DISPLAY_MAX / Math.max(meta.width ?? DISPLAY_MAX, meta.height ?? DISPLAY_MAX));
  const w = Math.round((meta.width ?? DISPLAY_MAX) * scale);
  const h = Math.round((meta.height ?? DISPLAY_MAX) * scale);
  const scan = scale < 1 ? await img.resize(w, h, { kernel: "lanczos3" }).toBuffer() : await img.toBuffer();

  const border = Math.max(6, Math.round(w * 0.03)); // the crisp frame around the scan
  const pad = Math.max(10, Math.round(w * 0.06)); // room for the shadow
  const radius = Math.round(w * 0.05);
  const innerR = Math.max(2, radius - border);
  const fw = w + 2 * border, fh = h + 2 * border;
  const W = fw + 2 * pad, H = fh + 2 * pad;

  const shadow = await sharp(
    Buffer.from(`<svg width="${W}" height="${H}"><rect x="${pad}" y="${pad + Math.round(pad * 0.35)}" width="${fw}" height="${fh}" rx="${radius}" fill="rgb(11,31,58)" fill-opacity="0.38"/></svg>`),
  )
    .blur(Math.max(1, pad * 0.45))
    .png()
    .toBuffer();
  const frame = Buffer.from(
    `<svg width="${W}" height="${H}"><rect x="${pad + 0.5}" y="${pad + 0.5}" width="${fw - 1}" height="${fh - 1}" rx="${radius}" fill="#ffffff" stroke="rgba(11,31,58,0.14)" stroke-width="1"/></svg>`,
  );
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${innerR}" fill="#fff"/></svg>`);
  const rounded = await sharp(scan).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const innerEdge = Buffer.from(
    `<svg width="${W}" height="${H}"><rect x="${pad + border + 0.75}" y="${pad + border + 0.75}" width="${w - 1.5}" height="${h - 1.5}" rx="${innerR}" fill="none" stroke="rgba(11,31,58,0.35)" stroke-width="1.5"/></svg>`,
  );
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: frame, left: 0, top: 0 },
      { input: rounded, left: pad + border, top: pad + border },
      { input: innerEdge, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

/** Make and store a card's display image. Returns its stored path, or null if the scan can't be read. */
export async function presentCard(card: { id: string; frontImage: string | null }) {
  if (!card.frontImage) return null;
  const img = await readStored(card.frontImage);
  if (!img) return null;
  const out = await presentScan(img.buf);
  const rel = `display/${card.frontImage.replace(/\.[a-z0-9]+$/i, "")}.png`;
  await putObject(rel, new Uint8Array(out), "image/png");
  return rel;
}
