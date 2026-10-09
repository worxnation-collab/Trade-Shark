/* eslint-disable @typescript-eslint/no-explicit-any */
import { cropCard, detectCards } from "@/lib/flatbed/detect";
import { cvReady } from "@/lib/flatbed/loadCv";
import type { UploadItem } from "./upload";

/**
 * PDFs of scanned cards, split in the browser so no PDF or WASM code ships in the server bundle:
 * pdf.js renders each page at 300 dpi; a page with several cards is cropped here with the flatbed detector
 * (one crop per card, reading order); a one-card page is sent whole and the server trims it to the card.
 * Every image goes up as a front scan tagged with its PDF and page, so a page is never lost.
 */
const DPI = 300;

let cvP: Promise<any> | null = null;
function loadCv(src: string) {
  const w = window as any;
  if (w.__tsCv) return cvReady(w.__tsCv);
  return (cvP ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      w.__tsCv = w.cv;
      cvReady(w.cv).then(res);
    };
    s.onerror = () => rej(new Error("Couldn't load OpenCV"));
    document.body.appendChild(s);
  }));
}

async function loadPdfJs(version: string) {
  const base = `/vendor/pdfjs-${version}`;
  const lib: any = await import(/* webpackIgnore: true */ `${base}/pdf.min.mjs`);
  lib.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;
  return lib;
}

export async function sha256(file: Blob) {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("JPEG encode failed"))), "image/jpeg", 0.92));

export async function pdfPageCount(file: File, pdfjsVersion: string) {
  const lib = await loadPdfJs(pdfjsVersion);
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

/**
 * Render and split every page. `send` is called per page with that page's images (upload them right away, so a big
 * PDF never sits in memory). Pages that fail to render are returned so they can be flagged.
 */
export async function splitPdf(
  file: File,
  o: { pdfjsVersion: string; cvSrc: string; hash: string; pdfId: string; onPage?: (page: number, pages: number) => void; send: (items: UploadItem[]) => Promise<unknown> },
) {
  const lib = await loadPdfJs(o.pdfjsVersion);
  const cv = await loadCv(o.cvSrc).catch(() => null); // without OpenCV every page goes up whole (server trims it)
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const stem = file.name.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "pdf";
  const failed: { page: number; note: string }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    o.onPage?.(n, doc.numPages);
    try {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: DPI / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const base = { kind: "crop", side: "front", sheetName: `${file.name} · page ${n}`, sheetHash: o.hash, page: n, pdfId: o.pdfId };
      const pad = String(n).padStart(3, "0");
      let items: UploadItem[] = [];
      if (cv) {
        const src = cv.matFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        try {
          const boxes = detectCards(cv, src);
          if (boxes.length >= 2) {
            for (let i = 0; i < boxes.length; i++) {
              const crop = cropCard(cv, src, boxes[i]);
              const c = document.createElement("canvas");
              cv.imshow(c, crop);
              crop.delete();
              items.push({
                file: await toBlob(c),
                name: `${stem}-p${pad}-${i + 1}.jpg`,
                meta: { ...base, pairKey: `pdf${o.hash.slice(0, 10)}-p${n}-${i + 1}`, cropIndex: i + 1, cropBox: boxes[i].corners.map((p) => [Math.round(p.x), Math.round(p.y)]) },
              });
            }
          }
        } finally {
          src.delete();
        }
      }
      // One card (or no detector): the whole page, trimmed to the card on the server.
      if (!items.length) items = [{ file: await toBlob(canvas), name: `${stem}-p${pad}.jpg`, meta: { ...base, pairKey: `pdf${o.hash.slice(0, 10)}-p${n}-1`, cropIndex: 1, trim: true } }];
      canvas.width = canvas.height = 0;
      await o.send(items);
    } catch (e) {
      failed.push({ page: n, note: `couldn't read this page (${e instanceof Error ? e.message.slice(0, 60) : "error"})` });
    }
  }
  await doc.destroy();
  return { pages: doc.numPages as number, failed };
}
