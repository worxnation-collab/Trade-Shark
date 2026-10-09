/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import sharp, { type OverlayOptions } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { cropCard, detectCards, manualBox } from "@/lib/flatbed/detect";
import { cvReady } from "@/lib/flatbed/loadCv";
import { CARD_RATIO, center, checkSheetPairing, cropName, readingOrder, rowLayout, type CardBox } from "@/lib/flatbed/geometry";

let cv: any;
beforeAll(async () => {
  // Native require: the 10 MB opencv.js bundle is too big for vitest's transform pipeline.
  const mod = createRequire(import.meta.url)("@techstark/opencv-js");
  cv = await cvReady(mod);
}, 30000);

const CW = 750; // 2.5in @ 300dpi
const CH = 1050; // 3.5in @ 300dpi

/** A fake card: off-white border, colorful art, a dark name bar. */
function cardSvg(seed: number, border = "#f3f1ea") {
  let x = seed;
  let art = "";
  for (let i = 0; i < 12; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const c = x % 255;
    art += `<circle cx="${60 + (x % 630)}" cy="${150 + ((x >> 7) % 500)}" r="${30 + ((x >> 3) % 90)}" fill="rgb(${c},${(c * 3) % 255},${255 - c})"/>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">
    <rect width="${CW}" height="${CH}" rx="30" fill="${border}" stroke="#9a968c" stroke-width="3"/>
    <rect x="40" y="40" width="${CW - 80}" height="70" fill="#2a2a2a"/>
    <rect x="40" y="130" width="${CW - 80}" height="560" fill="#e9d38a"/>${art}
    <rect x="40" y="720" width="${CW - 80}" height="290" fill="#d8d2c2"/>
  </svg>`);
}

interface Place {
  left: number;
  top: number;
  angle?: number;
  seed: number;
}

async function sheet(places: Place[], opts: { bg?: string; lid?: boolean; specks?: boolean; border?: string } = {}) {
  const W = 2550;
  const H = 3300;
  const layers: OverlayOptions[] = [];
  for (const p of places) {
    let img = sharp(cardSvg(p.seed, opts.border)).png();
    if (p.angle) img = sharp(await img.toBuffer()).rotate(p.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();
    layers.push({ input: await img.toBuffer(), left: p.left, top: p.top });
  }
  if (opts.lid) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="${H}"><rect width="30" height="${H}" fill="#55524c"/></svg>`), left: W - 30, top: 0 });
  if (opts.specks) {
    let d = "";
    for (let i = 0; i < 60; i++) d += `<circle cx="${(i * 397) % W}" cy="${(i * 911) % H}" r="${2 + (i % 4)}" fill="#222"/>`;
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${d}</svg>`), left: 0, top: 0 });
  }
  const { data, info } = await sharp({ create: { width: W, height: H, channels: 4, background: opts.bg ?? "#fbfbf9" } })
    .composite(layers)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
}

// Realistic copier layout: 3×2, small gaps (2-5 mm at 300 dpi), a few cards slightly crooked, none overlapping.
const GRID: Place[] = [
  { left: 80, top: 150, seed: 1 },
  { left: 880, top: 170, seed: 2, angle: 4 },
  { left: 1730, top: 140, seed: 3 },
  { left: 90, top: 1500, seed: 4, angle: -4 },
  { left: 960, top: 1480, seed: 5 },
  { left: 1712, top: 1520, seed: 6, angle: 3 },
];

describe("flatbed detection", () => {
  it("finds 6 cards on a light lid, ignoring dust and the lid edge, in reading order", async () => {
    const src = await sheet(GRID, { lid: true, specks: true });
    const boxes = detectCards(cv, src);
    expect(boxes).toHaveLength(6);
    expect(rowLayout(boxes)).toEqual([3, 3]);
    // Reading order matches placement order.
    const cx = boxes.map((b) => center(b.corners));
    for (let i = 0; i < 6; i++) {
      const p = GRID[i];
      expect(Math.abs(cx[i].x - (p.left + CW / 2))).toBeLessThan(120);
      expect(Math.abs(cx[i].y - (p.top + CH / 2))).toBeLessThan(120);
    }
    // Crops are perspective-corrected, portrait, card-shaped, a bit larger than the card (margin).
    for (const b of boxes) {
      const crop = cropCard(cv, src, b, 0.025);
      expect(crop.cols / crop.rows).toBeGreaterThan(CARD_RATIO - 0.03);
      expect(crop.cols / crop.rows).toBeLessThan(CARD_RATIO + 0.03);
      expect(crop.cols).toBeGreaterThan(CW);
      expect(crop.cols).toBeLessThan(CW * 1.12);
      crop.delete();
    }
    src.delete();
  });

  it("works on a dark background (lid open) and with white-on-white cards", async () => {
    const dark = await sheet(GRID.slice(0, 3), { bg: "#141414", specks: false });
    expect(detectCards(cv, dark)).toHaveLength(3);
    dark.delete();
    const white = await sheet(GRID.slice(3), { bg: "#fdfdfd", border: "#fafafa" });
    const boxes = detectCards(cv, white);
    expect(boxes).toHaveLength(3);
    // The whole card, not the art window inside the white border.
    for (const b of boxes) {
      const crop = cropCard(cv, white, b, 0);
      expect(crop.cols).toBeGreaterThan(CW * 0.95);
      crop.delete();
    }
    white.delete();
  });

  it("turns a card laid sideways into a portrait crop", async () => {
    const src = await sheet([{ left: 400, top: 600, seed: 9, angle: 90 }]);
    const [b] = detectCards(cv, src);
    const crop = cropCard(cv, src, b, 0.02);
    expect(crop.rows).toBeGreaterThan(crop.cols);
    crop.delete();
    // Manual rotation flips orientation 90°.
    const turned = cropCard(cv, src, { ...b, rotation: 90 }, 0.02);
    expect(turned.cols).toBeGreaterThan(turned.rows);
    turned.delete();
    src.delete();
  });

  it("rejects a blank sheet and tiny specks", async () => {
    const src = await sheet([], { specks: true, lid: true });
    expect(detectCards(cv, src)).toHaveLength(0);
    src.delete();
  });
});

describe("touching cards", () => {
  it("splits two cards that touch into two boxes and flags them for a check", async () => {
    // 300 dpi letter sheet, two cards edge to edge with no gap.
    const src = await sheet([
      { left: 400, top: 600, seed: 21 },
      { left: 400 + CW, top: 600, seed: 22 },
    ]);
    const boxes = detectCards(cv, src, { dpi: 300 });
    expect(boxes).toHaveLength(2);
    const xs = boxes.map((b) => center(b.corners).x);
    expect(Math.abs(xs[0] - (400 + CW / 2))).toBeLessThan(40);
    expect(Math.abs(xs[1] - (400 + CW * 1.5))).toBeLessThan(40);
    src.delete();
  });
});

describe("flatbed pairing + naming", () => {
  const box = (x: number, y: number): CardBox => manualBox(x, y, x + 750, y + 1050);
  const fronts = [box(100, 100), box(900, 120), box(1700, 90), box(100, 1400), box(900, 1420)];

  it("orders top-to-bottom then left-to-right", () => {
    const shuffled = [fronts[4], fronts[1], fronts[3], fronts[0], fronts[2]];
    expect(readingOrder(shuffled).map((b) => b.id)).toEqual(fronts.map((b) => b.id));
  });

  it("pairs only identical layouts", () => {
    const backs = [box(90, 110), box(910, 100), box(1690, 120), box(110, 1410), box(890, 1400)];
    expect(checkSheetPairing(fronts, backs)).toEqual({ ok: true, count: 5 });
    expect(checkSheetPairing(fronts, backs.slice(0, 4))).toMatchObject({ ok: false });
    // Same count, different rows (3+2 vs 2+3): refuse.
    const other = [box(100, 100), box(900, 100), box(100, 1400), box(900, 1400), box(1700, 1400)];
    const r = checkSheetPairing(fronts, other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/3·2.*2·3/);
  });

  it("names crops batch-001.jpg / batch-001-back.jpg", () => {
    expect(cropName("batch", 1, "front")).toBe("batch-001.jpg");
    expect(cropName("batch", 12, "back")).toBe("batch-012-back.jpg");
  });
});

describe("scan DPI", () => {
  it("reads density from JPEG and PNG headers", async () => {
    const { readDpi } = await import("@/lib/flatbed/dpi");
    const jpg = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).withMetadata({ density: 600 }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).withMetadata({ density: 300 }).png().toBuffer();
    const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    expect(readDpi(ab(jpg))).toBe(600);
    expect(readDpi(ab(png))).toBe(300);
  });
});
