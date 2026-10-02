import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dHash, hamming } from "@/lib/images";

function noise(seed: number) {
  const w = 250, h = 350;
  const buf = Buffer.alloc(w * h * 3);
  let x = seed;
  // Blocky pseudo-random "art" so the image has real structure.
  for (let by = 0; by < h; by += 25)
    for (let bx = 0; bx < w; bx += 25) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const v = x % 256;
      for (let y = by; y < Math.min(h, by + 25); y++)
        for (let xx = bx; xx < Math.min(w, bx + 25); xx++) buf.fill(v, (y * w + xx) * 3, (y * w + xx) * 3 + 3);
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

describe("dHash near-duplicate detection", () => {
  it("matches a rescan, separates different cards", async () => {
    const a = await noise(1);
    const b = await noise(2);
    const rescan = await sharp(a).resize(400).modulate({ brightness: 1.05 }).jpeg({ quality: 55 }).toBuffer();
    const [ha, hb, hr] = await Promise.all([dHash(a), dHash(b), dHash(rescan)]);
    expect(ha).toHaveLength(64);
    expect(hamming(ha!, hr!)).toBeLessThanOrEqual(20);
    expect(hamming(ha!, hb!)).toBeGreaterThan(40);
  });
});
