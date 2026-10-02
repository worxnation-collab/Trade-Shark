import { hamming } from "./hash";
import { sideOf, stemOf } from "./parse";

export interface InFile {
  name: string; // original filename (may include folder path from a folder drop)
  readable: boolean;
  /** Set by the flatbed split: crop N of the front sheet and crop N of the back sheet share a key. */
  pairKey?: string | null;
  side?: string | null;
  /** 256-bit dHash; lets Auto tell whether a batch actually contains card backs. */
  phash?: string | null;
}

export interface PairGroup<T extends InFile> {
  pairKey: string;
  front?: T;
  back?: T;
  /** how the pair was formed */
  method: "filename" | "order" | "single" | "unreadable" | "sheet";
  pile: "none" | "unpaired" | "unreadable";
}

export type PairMode = "auto" | "filename" | "order" | "fronts";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Card backs within a game print the same design, so their fingerprints sit close together.
 * Measured on rendered scans (off-center, ±2° tilt, lighting and JPEG changes): backs ≤ 47 bits
 * apart, fronts sharing one frame ≥ 62, back vs front ≥ 88. The cutoff sits in that gap.
 */
export const BACK_NEAR = 52;

export interface BackDecision {
  result: "pairs" | "pairs-backs-first" | "fronts";
  reason: string;
  files: number;
  backLike: number;
}

/**
 * Decide, for files with no side tokens, whether they alternate front/back.
 * A file "looks like a back" when its fingerprint is near another file in this batch or near
 * the back of a card already in inventory. We only pair when backs sit in alternating positions;
 * a couple of matches (e.g. two copies of the same front) isn't enough.
 */
export function detectBacks<T extends InFile>(sorted: T[], knownBacks: string[] = []): { decision: BackDecision; looksBack: boolean[] } {
  const n = sorted.length;
  const near = (a: string, b: string) => hamming(a, b) <= BACK_NEAR;
  const inBatch = sorted.map((f, i) => (f.phash ? sorted.filter((g, j) => j !== i && g.phash && near(f.phash!, g.phash)).length : 0));
  const known = sorted.map((f) => !!f.phash && knownBacks.some((k) => near(f.phash!, k)));
  const looksBack = sorted.map((_, i) => known[i] || inBatch[i] > 0);
  const rate = (start: number) => {
    const idx = Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === start);
    return idx.length ? idx.filter((i) => looksBack[i]).length / idx.length : 0;
  };
  const odd = rate(1);
  const even = rate(0);
  const backLike = looksBack.filter(Boolean).length;
  const base = { files: n, backLike };
  if (n < 2) return { looksBack, decision: { ...base, result: "fronts", reason: "only one unlabeled file" } };
  if (odd >= 0.6 && even <= 0.4)
    return { looksBack, decision: { ...base, result: "pairs", reason: `every other file looks like a card back (${backLike} of ${n})` } };
  if (even >= 0.6 && odd <= 0.4)
    return { looksBack, decision: { ...base, result: "pairs-backs-first", reason: `backs come first in each pair (${backLike} of ${n} look like backs)` } };
  return {
    looksBack,
    decision: {
      ...base,
      result: "fronts",
      reason: backLike ? `no alternating backs (${backLike} of ${n} look back-like), treated as fronts` : "no card backs detected, treated as fronts",
    },
  };
}

/**
 * Pair fronts and backs.
 * - filename tokens: card001-front / card001-back, card001_f / card001_b
 * - order: sorted front, back, front, back...
 * - fronts: every file is its own card, no backs
 * Auto = tokens first; untokened leftovers pair by order (odd one out goes to Unpaired).
 * Nothing is dropped: unreadable files and orphans land in review piles.
 */
export function pairFiles<T extends InFile>(
  files: T[],
  mode: PairMode = "auto",
  opts: { knownBacks?: string[]; onDecision?: (d: BackDecision) => void } = {},
): PairGroup<T>[] {
  const out: PairGroup<T>[] = [];
  // Flatbed crops arrive already paired by sheet position. Never re-pair them by name or order.
  const explicit = new Map<string, { front?: T; back?: T }>();
  for (const f of files) {
    if (!f.pairKey || !f.readable) continue;
    const g = explicit.get(f.pairKey) ?? {};
    g[f.side === "back" ? "back" : "front"] = f;
    explicit.set(f.pairKey, g);
  }
  for (const [key, g] of [...explicit.entries()].sort((a, b) => collator.compare(a[0], b[0]))) {
    if (g.front && g.back) out.push({ pairKey: key, front: g.front, back: g.back, method: "sheet", pile: "none" });
    else out.push({ pairKey: key, front: g.front ?? g.back, method: "sheet", pile: g.front ? "none" : "unpaired" });
  }
  files = files.filter((f) => !(f.pairKey && f.readable));
  const readable = files.filter((f) => f.readable);
  for (const f of files.filter((f) => !f.readable)) {
    out.push({ pairKey: stemOf(f.name), front: f, method: "unreadable", pile: "unreadable" });
  }

  if (mode === "fronts") {
    for (const f of [...readable].sort((a, b) => collator.compare(a.name, b.name))) {
      out.push({ pairKey: stemOf(f.name), front: f, method: "single", pile: "none" });
    }
    return out;
  }

  const tokened = new Map<string, { front?: T; back?: T; extra: T[] }>();
  const plain: T[] = [];
  for (const f of readable) {
    const dir = f.name.includes("/") ? f.name.slice(0, f.name.lastIndexOf("/") + 1) : "";
    const { base, side } = sideOf(stemOf(f.name));
    if (side && mode !== "order") {
      const key = (dir + base).toLowerCase();
      const g = tokened.get(key) ?? { extra: [] };
      if (g[side]) g.extra.push(f);
      else g[side] = f;
      tokened.set(key, g);
    } else plain.push(f);
  }

  for (const [key, g] of [...tokened.entries()].sort((a, b) => collator.compare(a[0], b[0]))) {
    if (g.front && g.back) out.push({ pairKey: key, front: g.front, back: g.back, method: "filename", pile: "none" });
    else out.push({ pairKey: key, front: g.front ?? g.back, method: "single", pile: "unpaired" });
    for (const x of g.extra) out.push({ pairKey: `${key}#dup`, front: x, method: "single", pile: "unpaired" });
  }

  if (mode === "filename") {
    for (const f of plain) out.push({ pairKey: stemOf(f.name), front: f, method: "single", pile: "unpaired" });
    return out;
  }

  const sorted = [...plain].sort((a, b) => collator.compare(a.name, b.name));
  if (mode === "auto" && sorted.length) {
    const { decision, looksBack } = detectBacks(sorted, opts.knownBacks);
    opts.onDecision?.(decision);
    if (decision.result === "fronts") {
      // Never let a stray back become its own card silently: if it matches a back already in
      // inventory or a cluster of 3+ in this batch, park it in Unpaired for review.
      const strong = sorted.map(
        (f, i) =>
          looksBack[i] &&
          !!f.phash &&
          ((opts.knownBacks ?? []).some((k) => hamming(f.phash!, k) <= BACK_NEAR) ||
            sorted.filter((g) => g !== f && g.phash && hamming(f.phash!, g.phash) <= BACK_NEAR).length >= 2),
      );
      sorted.forEach((f, i) => out.push({ pairKey: stemOf(f.name), front: f, method: "single", pile: strong[i] ? "unpaired" : "none" }));
      return out;
    }
    if (decision.result === "pairs-backs-first") {
      for (let i = 0; i < sorted.length; i += 2) {
        const back = sorted[i];
        const front = sorted[i + 1];
        if (front) out.push({ pairKey: `${stemOf(front.name)}+${stemOf(back.name)}`, front, back, method: "order", pile: "none" });
        else out.push({ pairKey: stemOf(back.name), front: back, method: "single", pile: "unpaired" });
      }
      return out;
    }
  }
  for (let i = 0; i < sorted.length; i += 2) {
    const front = sorted[i];
    const back = sorted[i + 1];
    if (back) out.push({ pairKey: `${stemOf(front.name)}+${stemOf(back.name)}`, front, back, method: "order", pile: "none" });
    else out.push({ pairKey: stemOf(front.name), front, method: "single", pile: "unpaired" });
  }
  return out;
}

const MAGIC: [number[], string][] = [
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0x49, 0x49, 0x2a, 0x00], "image/tiff"],
  [[0x4d, 0x4d, 0x00, 0x2a], "image/tiff"],
];

/** Sniff the real type from bytes. Anything we can't show in a browser is "unreadable". */
export function sniffImage(buf: Uint8Array): { readable: boolean; mime: string; ext: string } {
  if (buf.length < 12) return { readable: false, mime: "application/octet-stream", ext: "bin" };
  for (const [sig, mime] of MAGIC) {
    if (sig.every((b, i) => buf[i] === b)) {
      // TIFF scans store fine but most browsers can't render them.
      return { readable: mime !== "image/tiff", mime, ext: mime.split("/")[1].replace("jpeg", "jpg") };
    }
  }
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.slice(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { readable: true, mime: "image/webp", ext: "webp" };
  if (ascii(4, 8) === "ftyp" && /heic|heix|mif1|hevc/.test(ascii(8, 12)))
    return { readable: false, mime: "image/heic", ext: "heic" };
  return { readable: false, mime: "application/octet-stream", ext: "bin" };
}

export const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  tiff: "image/tiff",
  tif: "image/tiff",
  heic: "image/heic",
  bin: "application/octet-stream",
};
