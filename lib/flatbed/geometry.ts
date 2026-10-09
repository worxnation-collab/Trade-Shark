/**
 * Pure geometry for the flatbed split: no OpenCV here, so the editor UI and tests can use it directly.
 * Coordinates are full-resolution sheet pixels.
 */

export interface Pt {
  x: number;
  y: number;
}

export type Quad = [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL as they appear on the sheet

export interface CardBox {
  id: string;
  corners: Quad;
  /** Extra clockwise rotation applied to the crop, for cards laid sideways or upside down. */
  rotation: 0 | 90 | 180 | 270;
  /** "split": cut out of a blob of touching cards; edges are estimated, so the UI asks for a check. */
  source: "auto" | "manual" | "split";
  score?: number;
}

export const CARD_RATIO = 2.5 / 3.5; // 0.714

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function center(q: Quad): Pt {
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
}

/** Shoelace area. */
export function quadArea(q: Quad) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Order 4 arbitrary points as TL, TR, BR, BL (by angle around the centroid, starting top-left). */
export function orderCorners(pts: Pt[]): Quad {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // atan2 order runs from -π (left) clockwise in screen coords: pick the start closest to top-left.
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const s = p.x + p.y;
    if (s < best) {
      best = s;
      start = i;
    }
  });
  const q = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
  return q;
}

/** Side lengths of the card as laid on the sheet: width = top/bottom, height = left/right. */
export function quadSize(q: Quad) {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return { w, h };
}

/**
 * Corners to sample from, in output order (output TL, TR, BR, BL), so the crop comes out portrait
 * and then honors the manual rotation.
 */
export function outputCorners(box: CardBox): Quad {
  const q = box.corners;
  const { w, h } = quadSize(q);
  // Landscape on the glass: start from the bottom-left so the card's left edge becomes its top.
  let steps = w > h ? 3 : 0;
  steps += box.rotation / 90;
  const r = ((steps % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i + r) % 4]) as Quad;
}

/** Grow a quad around its centroid so the crop keeps a thin margin and never clips the border. */
export function expandQuad(q: Quad, marginFrac: number): Quad {
  const c = center(q);
  const { w, h } = quadSize(q);
  const pad = Math.min(w, h) * marginFrac;
  return q.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    // Corners sit on the diagonal; moving pad*√2 along it adds ~pad on each side.
    const k = (pad * Math.SQRT2) / len;
    return { x: p.x + dx * k, y: p.y + dy * k };
  }) as Quad;
}

/**
 * Reading order: group into rows (centers within half a card height), rows top to bottom,
 * cards left to right within a row.
 */
export function readingOrder<T extends { corners: Quad }>(boxes: T[]): T[] {
  return groupRows(boxes).flat();
}

export function groupRows<T extends { corners: Quad }>(boxes: T[]): T[][] {
  if (!boxes.length) return [];
  const heights = boxes.map((b) => Math.max(quadSize(b.corners).w, quadSize(b.corners).h)).sort((a, b) => a - b);
  const tol = heights[Math.floor(heights.length / 2)] * 0.5;
  const byY = [...boxes].sort((a, b) => center(a.corners).y - center(b.corners).y);
  const rows: T[][] = [];
  let rowY = -Infinity;
  for (const b of byY) {
    const y = center(b.corners).y;
    if (!rows.length || y - rowY > tol) {
      rows.push([b]);
      rowY = y;
    } else {
      rows[rows.length - 1].push(b);
      // Track the row's running mean so a slightly tilted row stays together.
      rowY = rows[rows.length - 1].reduce((s, x) => s + center(x.corners).y, 0) / rows[rows.length - 1].length;
    }
  }
  return rows.map((r) => r.sort((a, b) => center(a.corners).x - center(b.corners).x));
}

/** Cards per row, e.g. [3, 3, 2]. Used to refuse pairing fronts and backs laid out differently. */
export function rowLayout(boxes: { corners: Quad }[]) {
  return groupRows(boxes).map((r) => r.length);
}

export type PairCheck = { ok: true; count: number } | { ok: false; reason: string };

/**
 * Fronts and backs pair by crop number only when both sheets have the same layout.
 * Never guess across different layouts.
 */
export function checkSheetPairing(fronts: { corners: Quad }[], backs: { corners: Quad }[]): PairCheck {
  const fl = rowLayout(fronts);
  const bl = rowLayout(backs);
  if (fronts.length !== backs.length)
    return { ok: false, reason: `Front scan has ${fronts.length} card(s), back scan has ${backs.length}.` };
  if (fl.join(",") !== bl.join(","))
    return { ok: false, reason: `Layouts differ: fronts are ${fl.join("·")} per row, backs are ${bl.join("·")}.` };
  return { ok: true, count: fronts.length };
}

export function aabb(q: Quad) {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function iou(a: Quad, b: Quad) {
  const A = aabb(a);
  const B = aabb(b);
  const ix = Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0));
  const iy = Math.max(0, Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0));
  const inter = ix * iy;
  const ua = (A.x1 - A.x0) * (A.y1 - A.y0) + (B.x1 - B.x0) * (B.y1 - B.y0) - inter;
  return ua > 0 ? inter / ua : 0;
}

export function pointInQuad(p: Pt, q: Quad) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const cropName = (prefix: string, n: number, side: "front" | "back") =>
  `${prefix}-${String(n).padStart(3, "0")}${side === "back" ? "-back" : ""}.jpg`;
