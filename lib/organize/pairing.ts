import { sideOf, stemOf } from "./parse";

export interface InFile {
  name: string; // original filename (may include folder path from a folder drop)
  readable: boolean;
  /** Set by the flatbed split: crop N of the front sheet and crop N of the back sheet share a key. */
  pairKey?: string | null;
  side?: string | null;
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
 * Pair fronts and backs.
 * - filename tokens: card001-front / card001-back, card001_f / card001_b
 * - order: sorted front, back, front, back...
 * - fronts: every file is its own card, no backs
 * Auto = tokens first; untokened leftovers pair by order (odd one out goes to Unpaired).
 * Nothing is dropped: unreadable files and orphans land in review piles.
 */
export function pairFiles<T extends InFile>(files: T[], mode: PairMode = "auto"): PairGroup<T>[] {
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
