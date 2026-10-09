import sharp from "sharp";
import { CARD_RATIO } from "./flatbed/geometry";

/**
 * Server half of PDF ingest (the browser renders the pages, see lib/client/pdfSplit.ts). A page that holds one card on
 * a plain background is trimmed here to the card: the background colour comes from the page border, the card is the
 * region that differs from it, and the crop is its straight bounding box. The white margin goes; the card is never
 * turned a few degrees (upright-ing happens later, in 90° steps only). sharp only: no WASM in the server bundle.
 */
export async function trimToCard(input: Uint8Array): Promise<{ jpeg: Buffer; box: number[][]; blank: boolean } | null> {
  const img = sharp(input).rotate();
  const { data, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels;
  const edge = Math.max(2, Math.round(Math.min(W, H) * 0.015));
  // Background: median colour of a thin strip around the page edge.
  const samples: number[][] = [[], [], []];
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      if (x >= edge && x < W - edge && y >= edge && y < H - edge) continue;
      const i = (y * W + x) * C;
      for (let c = 0; c < 3; c++) samples[c].push(data[i + c]);
    }
  const bg = samples.map((v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 255);
  // Per row / column: how much of it differs from the background.
  const rows = new Float64Array(H);
  const cols = new Float64Array(W);
  let differing = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
      if (d > 28) {
        rows[y]++;
        cols[x]++;
        differing++;
      }
    }
  if (differing < W * H * 0.02) return { jpeg: await img.jpeg({ quality: 92 }).toBuffer(), box: [], blank: true };
  // The card spans the rows/columns where a good share of pixels differ (dust and scanner noise don't).
  const span = (p: Float64Array, len: number, other: number) => {
    const on = (v: number) => v > other * 0.2;
    let a = 0;
    while (a < p.length && !on(p[a])) a++;
    let b = p.length - 1;
    while (b > a && !on(p[b])) b--;
    return [a, Math.min(len - 1, b)];
  };
  const [y0, y1] = span(rows, H, W);
  const [x0, x1] = span(cols, W, H);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const ratio = Math.min(w, h) / Math.max(w, h);
  const pageIsCard = Math.abs(Math.min(W, H) / Math.max(W, H) - CARD_RATIO) < 0.05;
  if (w * h < W * H * 0.3 || Math.abs(ratio - CARD_RATIO) > 0.07) {
    // A page scanned tight to the card (its own border is the "background"): the page is the card.
    if (pageIsCard) return { jpeg: await img.jpeg({ quality: 92 }).toBuffer(), box: [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], blank: false };
    return null; // not one card: flag the page
  }
  const jpeg = await img.extract({ left: x0, top: y0, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
  return { jpeg, box: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], blank: false };
}
