import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { trimToCard } from "@/lib/pdf";

const card = (seed: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1050"><rect width="750" height="1050" rx="30" fill="#c9cdd2"/><rect x="40" y="40" width="670" height="70" fill="#2a2a2a"/><rect x="40" y="130" width="670" height="560" fill="hsl(${seed * 70},70%,55%)"/><circle cx="${200 + seed * 60}" cy="400" r="120" fill="#223"/><rect x="40" y="720" width="670" height="290" fill="#d8d2c2"/></svg>`,
  );

describe("PDF page trim (server)", () => {
  it("a card on a white page: the margin goes, the crop is the card, not turned", async () => {
    const page = await sharp({ create: { width: 950, height: 1300, channels: 3, background: "#ffffff" } })
      .composite([{ input: await sharp(card(1)).png().toBuffer(), left: 100, top: 120 }])
      .jpeg()
      .toBuffer();
    const r = (await trimToCard(page))!;
    expect(r).not.toBe(null);
    const m = await sharp(r.jpeg).metadata();
    expect(Math.abs(m.width! - 750)).toBeLessThan(12);
    expect(Math.abs(m.height! - 1050)).toBeLessThan(12);
  });

  it("a page already tight to the card stays the card", async () => {
    const r = (await trimToCard(await sharp(card(2)).jpeg().toBuffer()))!;
    const m = await sharp(r.jpeg).metadata();
    expect(m.height! > m.width!).toBe(true);
  });

  it("a blank page is marked blank; a page that isn't one card is null (flagged)", async () => {
    const blank = await trimToCard(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#fff" } }).jpeg().toBuffer());
    expect(blank?.blank).toBe(true);
    const wide = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#fff" } })
      .composite([{ input: await sharp({ create: { width: 1500, height: 300, channels: 3, background: "#123" } }).png().toBuffer(), left: 50, top: 300 }])
      .jpeg()
      .toBuffer();
    expect(await trimToCard(wide)).toBe(null);
  });
});
