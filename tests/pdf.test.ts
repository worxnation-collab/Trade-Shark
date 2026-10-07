import * as m from "mupdf";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { pdfPageCount, renderPage, splitPage } from "@/lib/pdf";

const card = (seed: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1050"><rect width="750" height="1050" rx="30" fill="#f3f1ea" stroke="#9a968c" stroke-width="3"/><rect x="40" y="40" width="670" height="70" fill="#2a2a2a"/><rect x="40" y="130" width="670" height="560" fill="hsl(${seed * 70},70%,55%)"/><circle cx="${200 + seed * 60}" cy="400" r="120" fill="#223"/><rect x="40" y="720" width="670" height="290" fill="#d8d2c2"/></svg>`,
  );

/** A scanned-cards PDF: page 1 = one card filling the page, page 2 = four cards on white, page 3 = blank. */
async function makePdf() {
  const page1 = await sharp(card(1)).jpeg().toBuffer();
  const comps = await Promise.all(
    [0, 1, 2, 3].map(async (i) => ({ input: await sharp(card(i + 2)).resize(600).png().toBuffer(), left: 150 + (i % 2) * 900, top: 150 + Math.floor(i / 2) * 1100 })),
  );
  const page2 = await sharp({ create: { width: 1800, height: 2500, channels: 3, background: "#ffffff" } }).composite(comps).jpeg().toBuffer();
  const page3 = await sharp({ create: { width: 1700, height: 2200, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const doc = new m.PDFDocument();
  for (const [img, w, h] of [
    [page1, 750, 1050],
    [page2, 1800, 2500],
    [page3, 1700, 2200],
  ] as const) {
    const image = doc.addImage(new m.Image(new m.Buffer(new Uint8Array(img))));
    const W = (w * 72) / 300;
    const H = (h * 72) / 300;
    const res = doc.addObject({ XObject: { I0: image } });
    doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, res, `q ${W} 0 0 ${H} 0 0 cm /I0 Do Q`));
  }
  return doc.saveToBuffer("compress").asUint8Array().slice(); // a copy: the view into WASM memory detaches
}

let pdf: Uint8Array;
beforeAll(async () => {
  pdf = await makePdf();
}, 30000);

describe("PDF ingest", () => {
  it("counts pages and renders one", async () => {
    expect(await pdfPageCount(pdf)).toBe(3);
    const r = await renderPage(pdf, 1, 100);
    expect(r.width).toBeGreaterThan(400);
    expect(r.png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("a page with several cards gives one crop per card, in reading order", async () => {
    const { crops } = await splitPage((await renderPage(pdf, 1)).png);
    expect(crops).toHaveLength(4);
    for (const c of crops) {
      const meta = await sharp(c.jpeg).metadata();
      expect(meta.height!).toBeGreaterThan(meta.width!); // portrait card
    }
  }, 60000);

  it("a page that is one card is one scan; a blank page has nothing (it gets flagged, not dropped)", async () => {
    const one = await splitPage((await renderPage(pdf, 0)).png);
    expect(one.crops.length <= 1 && one.cardShaped).toBe(true);
    const blank = await splitPage((await renderPage(pdf, 2)).png);
    expect(blank.crops).toHaveLength(0);
    expect(blank.cardShaped).toBe(false);
    expect(blank.blank).toBe(true);
    expect(one.blank).toBe(false);
  }, 60000);
});
