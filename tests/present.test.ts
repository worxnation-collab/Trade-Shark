import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { measureSkew, presentScan } from "@/lib/present";

/** A fake card: a busy rectangle on a light scanner bed, tilted by `deg`. */
async function scan(deg: number) {
  const card = await sharp({ create: { width: 250, height: 350, channels: 3, background: "#d8b23a" } })
    .composite([{ input: Buffer.from('<svg width="250" height="350"><rect x="20" y="40" width="210" height="150" fill="#2a6fb0"/><rect x="20" y="230" width="210" height="90" fill="#ffffff"/></svg>') }])
    .png()
    .toBuffer();
  return sharp(card).extend({ top: 50, bottom: 50, left: 50, right: 50, background: "#f4f4f2" }).rotate(deg, { background: "#f4f4f2" }).png().toBuffer();
}

describe("card presentation", () => {
  it("measures a small skew within a few tenths of a degree, either way", async () => {
    for (const deg of [0, 2.5, 6, -4]) expect(Math.abs((await measureSkew(await scan(deg))).deg - deg)).toBeLessThanOrEqual(0.3);
  });

  it("a tight crop (all card) is left alone", async () => {
    const tight = await sharp({ create: { width: 250, height: 350, channels: 3, background: "#d8b23a" } }).png().toBuffer();
    expect((await measureSkew(tight)).deg).toBe(0);
  });

  it("frames the straightened, trimmed scan with a border and shadow, never upscaled", async () => {
    const out = await presentScan(await scan(5));
    const m = await sharp(out).metadata();
    expect(m.format).toBe("png");
    expect(m.hasAlpha).toBe(true);
    // ~250 wide card + border + shadow padding; nowhere near the 350+ of an untrimmed tilted bed.
    expect(m.width).toBeGreaterThan(270);
    expect(m.width).toBeLessThan(330);
    const corner = await sharp(out).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(corner[3]).toBe(0); // transparent outside the shadow
  });
});
