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

describe("back detection threshold on real dHash", () => {
  const backSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" rx="22" fill="#1f4fa8"/><circle cx="250" cy="350" r="150" fill="#d33"/><rect x="95" y="338" width="310" height="24" fill="#111"/><circle cx="250" cy="350" r="55" fill="#fff" stroke="#111" stroke-width="14"/><rect x="18" y="18" width="464" height="664" rx="16" fill="none" stroke="#173d85" stroke-width="10"/></svg>`);
  // Same frame, different art: the hardest case for telling fronts apart.
  const frontSvg = (seed: number) => {
    let x = seed * 7919;
    let art = "";
    for (let i = 0; i < 10; i++) {
      x = (x * 48271) % 2147483647;
      art += `<circle cx="${40 + (x % 420)}" cy="${120 + ((x >> 5) % 300)}" r="${20 + ((x >> 3) % 70)}" fill="hsl(${x % 360},70%,${35 + (x % 40)}%)"/>`;
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" rx="22" fill="#f1d76a"/><rect x="28" y="30" width="444" height="50" fill="#fff"/><rect x="28" y="95" width="444" height="360" fill="#bfe3f0"/>${art}<rect x="28" y="470" width="444" height="200" fill="#fff7dd"/></svg>`);
  };
  // A different physical copy of the back: off-center by a few %, slightly rotated, lighter or darker scan.
  const scan = async (svg: Buffer, i: number) => {
    const base = await sharp(svg).png().toBuffer();
    const pad = { top: 6 + (i % 4) * 5, bottom: 6 + ((i + 2) % 4) * 5, left: 5 + ((i + 1) % 3) * 6, right: 5 + (i % 3) * 6, background: "#f8f8f6" };
    return sharp(await sharp(base).extend(pad).rotate((i % 5) - 2, { background: "#f8f8f6" }).png().toBuffer())
      .modulate({ brightness: 0.92 + (i % 4) * 0.05 })
      .jpeg({ quality: 70 + (i % 3) * 10 })
      .toBuffer();
  };

  it("backs cluster under BACK_NEAR, fronts with the same frame stay above it", async () => {
    const { BACK_NEAR } = await import("@/lib/organize/pairing");
    const backs = await Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => dHash(await scan(backSvg, i))));
    const fronts = await Promise.all([1, 2, 3, 4, 5, 6].map(async (i) => dHash(await scan(frontSvg(i), i))));
    const pairs = (xs: (string | null)[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => hamming(a!, b!)));
    const backD = pairs(backs);
    const frontD = pairs(fronts);
    const cross = backs.flatMap((b) => fronts.map((f) => hamming(b!, f!)));
    console.log("backs max", Math.max(...backD), "fronts min", Math.min(...frontD), "back-front min", Math.min(...cross));
    expect(Math.max(...backD)).toBeLessThanOrEqual(BACK_NEAR);
    expect(Math.min(...frontD)).toBeGreaterThan(BACK_NEAR);
    expect(Math.min(...cross)).toBeGreaterThan(BACK_NEAR);
  });
});
