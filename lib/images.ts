import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { dataDir } from "./env";
import { MIME_BY_EXT, sniffImage } from "./organize/pairing";

export function imagesRoot() {
  return path.resolve(process.cwd(), dataDir(), "images");
}

/** Resolve a stored relative path inside the images root; refuses traversal. */
export function resolveImage(rel: string): string | null {
  const root = imagesRoot();
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

export function sha256(buf: Uint8Array) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * 256-bit difference hash (16x16 gradients). Survives re-scans and re-compression of the same card
 * but separates different cards that share a frame layout far better than the classic 64-bit dHash.
 */
export async function dHash(buf: Uint8Array): Promise<string | null> {
  try {
    const W = 17;
    const H = 16;
    // Normalize + blur first so lighting and JPEG noise don't flip bits in flat areas (borders, sky).
    const px = await sharp(buf).rotate().greyscale().normalise().blur(1.2).resize(W, H, { fit: "fill", kernel: "cubic" }).raw().toBuffer();
    let hex = "";
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W - 1; x++) row = (row << 1) | (px[y * W + x] > px[y * W + x + 1] + 1 ? 1 : 0);
      hex += (row >>> 0).toString(16).padStart(4, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

export function hamming(a: string, b: string) {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

export interface StoredImage {
  rel: string;
  hash: string;
  phash: string | null;
  readable: boolean;
  mime: string;
}

/**
 * Store an upload under data/images/<batchId>/<sha>.<ext>.
 * TIFF scans are converted to JPEG so the browser can show them; HEIC is attempted, else kept as unreadable.
 */
export async function storeUpload(batchId: string, buf: Uint8Array): Promise<StoredImage> {
  const hash = sha256(buf);
  let sniff = sniffImage(buf);
  let out: Uint8Array = buf;
  if (sniff.mime === "image/tiff" || sniff.mime === "image/heic") {
    try {
      out = await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer();
      sniff = { readable: true, mime: "image/jpeg", ext: "jpg" };
    } catch {
      /* keep original, stays unreadable */
    }
  }
  const dir = path.join(imagesRoot(), batchId);
  await mkdir(dir, { recursive: true });
  const rel = `${batchId}/${hash.slice(0, 24)}.${sniff.ext}`;
  await writeFile(path.join(imagesRoot(), rel), out);
  const phash = sniff.readable ? await dHash(out) : null;
  return { rel, hash, phash, readable: sniff.readable && phash !== null, mime: sniff.mime };
}

export async function readStored(rel: string) {
  const abs = resolveImage(rel);
  if (!abs) return null;
  try {
    const buf = await readFile(abs);
    const ext = rel.split(".").pop()!.toLowerCase();
    return { buf, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

/** JPEG <= ~1600px long edge for vision calls (keeps requests small and under provider limits). */
export async function forVision(rel: string): Promise<{ data: string; mime: "image/jpeg" } | null> {
  const img = await readStored(rel);
  if (!img) return null;
  try {
    const buf = await sharp(img.buf).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { data: buf.toString("base64"), mime: "image/jpeg" };
  } catch {
    return null;
  }
}
