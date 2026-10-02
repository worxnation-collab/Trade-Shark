/* eslint-disable @typescript-eslint/no-explicit-any */
import { CARD_RATIO, type CardBox, expandQuad, iou, orderCorners, outputCorners, pointInQuad, type Pt, type Quad, quadArea, quadSize, readingOrder, center } from "./geometry";

/**
 * Card detection + perspective crop with OpenCV (opencv.js). The same code runs in the browser
 * (flatbed page) and in Node (tests). `cv` is the loaded OpenCV module; Mats are RGBA.
 * No vision API is involved: this is plain contour geometry.
 */

type CV = any;
type Mat = any;

export interface DetectOptions {
  /** Smallest card as a fraction of the sheet area. A card on a letter-size glass is ~9%; dust is far below 1%. */
  minAreaFrac: number;
  /** Allowed deviation from the 2.5×3.5 ratio (0.714). */
  aspectTol: number;
  /** Contour area / rotated-rect area. Cards are ~1; lid edges, shadows and blobs are lower. */
  minRectangularity: number;
  /** Detection runs on a downscaled copy for speed; boxes are scaled back to full resolution. */
  maxDetectSide: number;
  /**
   * Scan resolution if known (JPEG/PNG metadata). Lets us know how big one card is, so two cards that
   * touch (5×3.5in looks card-shaped!) get split instead of cropped as one.
   */
  dpi?: number;
  /** Optional: receives every contour considered and why it was kept or dropped. */
  debug?: (info: { pass: number; areaFrac: number; aspect: number; rect: number; kept: boolean }) => void;
}

export const DEFAULT_DETECT: DetectOptions = { minAreaFrac: 0.012, aspectTol: 0.085, minRectangularity: 0.86, maxDetectSide: 1400 };

let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

function medianOf(mat: Mat): number {
  const data: Uint8Array = mat.data;
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(data.length / 200_000));
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    hist[data[i]]++;
    n++;
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n / 2) return v;
  }
  return 128;
}

/** Fill every external contour so card art with holes becomes one solid blob. */
function fillExternal(cv: CV, mask: Mat) {
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const filled = cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1);
  for (let i = 0; i < contours.size(); i++) cv.drawContours(filled, contours, i, new cv.Scalar(255), -1);
  contours.delete();
  hier.delete();
  return filled;
}

interface Candidate {
  corners: Quad; // detection-scale coords
  score: number;
  split?: boolean;
}

function rectCorners(cx: number, cy: number, w: number, h: number, angleDeg: number): Pt[] {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

const ratioOk = (a: number, b: number, tol: number) => Math.abs(Math.min(a, b) / Math.max(a, b) - CARD_RATIO) <= tol;

/** @param cardArea expected area of one card at detection scale, if known */
function candidatesFromMask(cv: CV, mask: Mat, opts: DetectOptions, out: Candidate[], pass: number, cardArea?: number) {
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const imgArea = mask.rows * mask.cols;
  const minArea = Math.max(opts.minAreaFrac * imgArea, cardArea ? cardArea * 0.55 : 0);
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area < minArea || area > 0.9 * imgArea) {
      if (area > 0.002 * imgArea) opts.debug?.({ pass, areaFrac: area / imgArea, aspect: 0, rect: 0, kept: false });
      c.delete();
      continue;
    }
    const rr = cv.minAreaRect(c);
    const w = rr.size.width;
    const h = rr.size.height;
    const aspect = Math.min(w, h) / Math.max(w, h);
    const rect = area / (w * h);

    // Several touching cards in one blob: split along the long side when the size says so.
    const n = cardArea ? Math.round(area / cardArea) : 1;
    if (n >= 2 && n <= 4 && Math.abs(area / cardArea! - n) < 0.35 && rect >= opts.minRectangularity) {
      const alongW = w >= h;
      const pw = alongW ? w / n : w;
      const ph = alongW ? h : h / n;
      if (ratioOk(pw, ph, opts.aspectTol)) {
        const rad = (rr.angle * Math.PI) / 180;
        const ux = alongW ? Math.cos(rad) : -Math.sin(rad);
        const uy = alongW ? Math.sin(rad) : Math.cos(rad);
        const step = alongW ? pw : ph;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * step;
          out.push({ corners: orderCorners(rectCorners(rr.center.x + ux * off, rr.center.y + uy * off, pw, ph, rr.angle)), score: rect - 0.1, split: true });
        }
        opts.debug?.({ pass, areaFrac: area / imgArea, aspect, rect, kept: true });
        c.delete();
        continue;
      }
    }

    const ok = Math.abs(aspect - CARD_RATIO) <= opts.aspectTol && rect >= opts.minRectangularity && (!cardArea || area < cardArea * 1.5);
    opts.debug?.({ pass, areaFrac: area / imgArea, aspect, rect, kept: ok });
    if (!ok) {
      c.delete();
      continue;
    }
    // Prefer the real 4 corners (handles slight perspective); fall back to the rotated rect.
    let pts: Pt[] | null = null;
    const approx = new cv.Mat();
    cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      pts = [];
      for (let q = 0; q < 4; q++) pts.push({ x: approx.data32S[q * 2], y: approx.data32S[q * 2 + 1] });
    }
    approx.delete();
    out.push({ corners: orderCorners(pts ?? rectCorners(rr.center.x, rr.center.y, w, h, rr.angle)), score: rect - Math.abs(aspect - CARD_RATIO) });
    c.delete();
  }
  contours.delete();
  hier.delete();
}

/**
 * One card's area in sheet pixels: from DPI when the file has it, else assume a full letter/A4 glass
 * when the sheet has that shape. Undefined when we can't tell (then touching cards aren't split).
 */
export function expectedCardArea(cols: number, rows: number, dpi?: number) {
  if (dpi && dpi >= 100 && dpi <= 2400) return 2.5 * dpi * 3.5 * dpi;
  const ratio = Math.min(cols, rows) / Math.max(cols, rows);
  if (ratio < 0.69 || ratio > 0.8) return undefined;
  // Letter is 11in long, A4 11.69in: split the difference.
  const d = Math.max(cols, rows) / 11.35;
  return 2.5 * d * 3.5 * d;
}

/**
 * Find card-shaped rectangles on a light or dark background.
 * Two passes (contrast-from-background and edges) catch both colorful cards and white-bordered
 * cards on a white lid; duplicates and boxes nested inside a card are dropped.
 */
export function detectCards(cv: CV, src: Mat, opts: Partial<DetectOptions> = {}): CardBox[] {
  const o = { ...DEFAULT_DETECT, ...opts };
  const scale = Math.min(1, o.maxDetectSide / Math.max(src.cols, src.rows));
  const small = new cv.Mat();
  cv.resize(src, small, new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)), 0, 0, cv.INTER_AREA);

  const rgb = new cv.Mat();
  cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
  const gray = new cv.Mat();
  cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  const hsv = new cv.Mat();
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const ch = new cv.MatVector();
  cv.split(hsv, ch);
  const sat = ch.get(1);

  const short = Math.min(small.rows, small.cols);
  const k = (f: number) => {
    const s = Math.max(3, Math.round(short * f) | 1);
    return cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(s, s));
  };
  const cands: Candidate[] = [];

  // Pass 1: anything that differs from the background level (gray distance or color).
  const bg = medianOf(gray);
  const bgMat = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1, new cv.Scalar(bg));
  const diff = new cv.Mat();
  cv.absdiff(gray, bgMat, diff);
  const m1 = new cv.Mat();
  cv.threshold(diff, m1, 28, 255, cv.THRESH_BINARY);
  const satMask = new cv.Mat();
  cv.threshold(sat, satMask, 55, 255, cv.THRESH_BINARY);
  cv.bitwise_or(m1, satMask, m1);
  const full = expectedCardArea(src.cols, src.rows, o.dpi);
  const cardArea = full ? full * scale * scale : undefined;
  const kSpeck = k(0.003);
  const kSep = k(0.006);
  cv.morphologyEx(m1, m1, cv.MORPH_OPEN, kSpeck);
  const f1 = fillExternal(cv, m1);
  // Shave the fill so cards that nearly touch separate again.
  cv.morphologyEx(f1, f1, cv.MORPH_OPEN, kSep);
  candidatesFromMask(cv, f1, o, cands, 1, cardArea);

  // Pass 2: edges — catches white-bordered cards on a white lid. A card outline is already a closed
  // loop, so only a hair of dilation is needed (more would bridge the gap to the next card).
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 30, 90);
  const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, edges, k3);
  const f2 = fillExternal(cv, edges);
  cv.morphologyEx(f2, f2, cv.MORPH_OPEN, kSep);
  candidatesFromMask(cv, f2, o, cands, 2, cardArea);

  for (const m of [small, rgb, gray, hsv, sat, bgMat, diff, m1, satMask, kSpeck, kSep, k3, f1, edges, f2]) m.delete();
  ch.delete();

  // Dedupe across passes; drop boxes sitting inside a bigger card (inner art frames).
  cands.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const c of cands) {
    if (kept.some((k2) => iou(k2.corners, c.corners) > 0.5)) continue;
    kept.push(c);
  }
  const final = kept.filter(
    (c) => !kept.some((o2) => o2 !== c && quadArea(o2.corners) > quadArea(c.corners) * 1.2 && pointInQuad(center(c.corners), o2.corners)),
  );

  const boxes: CardBox[] = final.map((c) => ({
    id: newId(),
    corners: c.corners.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad,
    rotation: 0,
    source: c.split ? "split" : "auto",
    score: Math.round(c.score * 100) / 100,
  }));
  return readingOrder(boxes);
}

/** A manual box from a dragged rectangle (sheet coords). */
export function manualBox(x0: number, y0: number, x1: number, y1: number): CardBox {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  return {
    id: newId(),
    corners: [
      { x: ax, y: ay },
      { x: bx, y: ay },
      { x: bx, y: by },
      { x: ax, y: by },
    ],
    rotation: 0,
    source: "manual",
  };
}

/**
 * Perspective-correct one card and crop with a small margin. Returns an RGBA Mat (caller deletes).
 * Output is portrait at the card's native scan resolution, capped at maxLongSide.
 */
export function cropCard(cv: CV, src: Mat, box: CardBox, marginFrac = 0.025, maxLongSide = 2100): Mat {
  const q = expandQuad(outputCorners(box), marginFrac);
  const { w, h } = quadSize(q);
  const s = Math.min(1, maxLongSide / Math.max(w, h));
  const W = Math.max(8, Math.round(w * s));
  const H = Math.max(8, Math.round(h * s));
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
  const M = cv.getPerspectiveTransform(from, to);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, M, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
  from.delete();
  to.delete();
  M.delete();
  return out;
}
