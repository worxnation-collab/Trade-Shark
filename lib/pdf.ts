/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import sharp from "sharp";
import { cropCard, detectCards } from "./flatbed/detect";
import { CARD_RATIO, readingOrder } from "./flatbed/geometry";
import { cvReady } from "./flatbed/loadCv";

/**
 * Scanned-card PDFs, split on the server one page per request (short requests on Netlify). Each page is rendered
 * with mupdf (WASM), the cards on it are found with the same opencv detector the flatbed splitter uses, and each
 * card is cropped to its own JPEG. One card on the page → one scan; several → one crop each. A page with no card
 * found is kept whole and flagged for a look, never dropped. The crops then go through the normal flow
 * (orient → identify → price → owner tag → bin).
 */
export const PDF_DPI = Number(process.env.PDF_DPI || 300);

let mupdfP: Promise<typeof import("mupdf")> | null = null;
const mupdf = () => (mupdfP ??= import("mupdf"));

let cvP: Promise<any> | null = null;
/** opencv.js in Node (native require: the 10 MB bundle is loaded once per function instance). */
export const nodeCv = () => (cvP ??= cvReady(createRequire(import.meta.url)("@techstark/opencv-js")));

export async function pdfPageCount(buf: Uint8Array) {
  const m = await mupdf();
  const doc = m.Document.openDocument(buf.slice(), "application/pdf") // mupdf takes the buffer it is given: pass a copy;
  try {
    return doc.countPages();
  } finally {
    doc.destroy?.();
  }
}

/** Render one page (0-based) to PNG at PDF_DPI. */
export async function renderPage(buf: Uint8Array, index: number, dpi = PDF_DPI) {
  const m = await mupdf();
  const doc = m.Document.openDocument(buf.slice(), "application/pdf") // mupdf takes the buffer it is given: pass a copy;
  try {
    const page = doc.loadPage(index);
    const pix = page.toPixmap(m.Matrix.scale(dpi / 72, dpi / 72), m.ColorSpace.DeviceRGB, false, true);
    const png = pix.asPNG();
    return { png: Buffer.from(png), width: pix.getWidth(), height: pix.getHeight() };
  } finally {
    doc.destroy?.();
  }
}

/**
 * One card on a plain background (a page per card): the background colour comes from the page border, the card is
 * the biggest region that differs from it, and the crop is its straight bounding box: the white margin goes, the
 * card is never turned by a few degrees here (upright-ing happens later, in 90° steps only).
 * Returns null unless that region is card-shaped and fills a good part of the page.
 */
export async function singleCardBox(rgba: Buffer, width: number, height: number) {
  const cv = await nodeCv();
  const src = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  // Background: median of a thin strip around the page edge.
  const edge = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  const samples: number[][] = [[], [], []];
  const d = rgb.data as Uint8Array;
  for (let y = 0; y < height; y += 2)
    for (let x = 0; x < width; x += 2) {
      if (x >= edge && x < width - edge && y >= edge && y < height - edge) continue;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) samples[c].push(d[i + c]);
    }
  const med = samples.map((v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 255);
  const bg = new cv.Mat(height, width, cv.CV_8UC3, new cv.Scalar(med[0], med[1], med[2]));
  const diff = new cv.Mat();
  cv.absdiff(rgb, bg, diff);
  const ch = new cv.MatVector();
  cv.split(diff, ch);
  const mask = new cv.Mat();
  cv.max(ch.get(0), ch.get(1), mask);
  cv.max(mask, ch.get(2), mask);
  cv.threshold(mask, mask, 28, 255, cv.THRESH_BINARY);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(3, Math.round(Math.min(width, height) * 0.01) | 1), Math.max(3, Math.round(Math.min(width, height) * 0.01) | 1)));
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k);
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k);
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let best: { x: number; y: number; width: number; height: number } | null = null;
  let bestArea = 0;
  for (let i = 0; i < contours.size(); i++) {
    const r = cv.boundingRect(contours.get(i));
    if (r.width * r.height > bestArea) {
      bestArea = r.width * r.height;
      best = r;
    }
  }
  for (const m of [src, rgb, bg, diff, mask, k, hier]) m.delete();
  ch.delete();
  contours.delete();
  if (!best) return null;
  const ratio = Math.min(best.width, best.height) / Math.max(best.width, best.height);
  if (bestArea < width * height * 0.35 || Math.abs(ratio - CARD_RATIO) > 0.07) return null;
  return best;
}

export interface PageCrop {
  jpeg: Buffer;
  index: number; // 1-based, reading order on the page
  box?: number[][];
}

/**
 * The cards on one rendered page. Several detected → one crop each (reading order). One → that crop.
 * None detected but the page itself is card-shaped → the page is the scan. Otherwise `crops` is empty (flag it).
 */
export async function splitPage(png: Buffer): Promise<{ crops: PageCrop[]; whole: Buffer; cardShaped: boolean; blank: boolean }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const whole = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  const ratio = Math.min(info.width, info.height) / Math.max(info.width, info.height);
  const cardShaped = Math.abs(ratio - CARD_RATIO) < 0.04; // a letter page (0.77) is not card-shaped
  // A blank (or nearly blank) page: almost no variation anywhere.
  const blank = (await sharp(png).greyscale().stats()).channels[0].stdev < 6;
  const cv = await nodeCv();
  const src = cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
  try {
    const boxes = readingOrder(detectCards(cv, src));
    // One card per page (the usual scanned-card PDF): crop it from the plain background.
    if (boxes.length < 2) {
      const r = await singleCardBox(data, info.width, info.height);
      if (r) {
        const jpeg = await sharp(png).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).jpeg({ quality: 92 }).toBuffer();
        const box = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
        return { crops: [{ jpeg, index: 1, box }], whole, cardShaped, blank };
      }
    }
    const crops: PageCrop[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const out = cropCard(cv, src, boxes[i]);
      try {
        const jpeg = await sharp(Buffer.from(out.data), { raw: { width: out.cols, height: out.rows, channels: 4 } }).jpeg({ quality: 92 }).toBuffer();
        crops.push({ jpeg, index: i + 1, box: boxes[i].corners.map((c) => [Math.round(c.x), Math.round(c.y)]) });
      } finally {
        out.delete();
      }
    }
    return { crops, whole, cardShaped, blank };
  } finally {
    src.delete();
  }
}
