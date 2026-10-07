import { createHash } from "node:crypto";
import { db } from "./db";
import { renderPage, splitPage } from "./pdf";
import { storeBatchFiles } from "./pipeline";
import { getObject } from "./storage";

/**
 * PDF uploads: register the PDF (skipped if the same file was ingested before), then split it one page per call.
 * Each page's cards are stored as crops (front scans) and go through organize → orient → identify → price → owner → bin
 * like any other scan. A page with no card found is kept whole and flagged; a page that can't be read is recorded.
 */
export interface PageResult {
  page: number;
  cards: number;
  note?: string; // why this page needs a look
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function registerPdf(batchId: string, name: string, buf: Uint8Array, rel?: string) {
  const hash = sha(buf);
  const seen = await db.pdfIngest.findUnique({ where: { hash } });
  if (seen) {
    const b = await db.batch.findUnique({ where: { id: seen.batchId }, select: { name: true } });
    return { skipped: true as const, pdfId: seen.id, pages: seen.pages, batchName: b?.name ?? "an earlier batch" };
  }
  const { pdfPageCount } = await import("./pdf");
  const pages = await pdfPageCount(buf);
  // Keep the original PDF with the batch (never a card itself).
  const [file] = await storeBatchFiles(batchId, [{ name: `pdf/${name}`, buf, rel, meta: { kind: "sheet" } }]);
  const p = await db.pdfIngest.create({ data: { batchId, name, hash, rel: file.rel, pages } });
  return { skipped: false as const, pdfId: p.id, pages };
}

async function saveResult(pdfId: string, r: PageResult) {
  const p = await db.pdfIngest.findUniqueOrThrow({ where: { id: pdfId } });
  const list = (JSON.parse(p.results) as PageResult[]).filter((x) => x.page !== r.page);
  list.push(r);
  list.sort((a, b) => a.page - b.page);
  await db.pdfIngest.update({ where: { id: pdfId }, data: { results: JSON.stringify(list) } });
  return r;
}

/** Split one page (1-based) into card crops and store them. Never throws: a bad page is recorded and flagged. */
export async function ingestPdfPage(batchId: string, pdfId: string, page: number): Promise<PageResult> {
  const p = await db.pdfIngest.findFirstOrThrow({ where: { id: pdfId, batchId } });
  const done = (JSON.parse(p.results) as PageResult[]).find((x) => x.page === page);
  if (done) return done; // a retried request doesn't add the page twice
  if (page < 1 || page > p.pages) return { page, cards: 0, note: "no such page" };
  try {
    const buf = await getObject(p.rel);
    if (!buf) throw new Error("PDF not found in storage");
    const r = await renderPage(buf, page - 1);
    const split = await splitPage(r.png);
    const base = { kind: "crop" as const, side: "front" as const, sheetName: `${p.name} · page ${page}`, sheetRel: p.rel, sheetHash: p.hash, page };
    const stem = p.name.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
    if (split.crops.length) {
      await storeBatchFiles(
        batchId,
        split.crops.map((c) => ({
          name: `${stem}-p${String(page).padStart(3, "0")}-${c.index}.jpg`,
          buf: new Uint8Array(c.jpeg),
          meta: { ...base, pairKey: `pdf${p.hash.slice(0, 10)}-p${page}-${c.index}`, cropIndex: c.index, cropBox: c.box },
        })),
      );
      return saveResult(pdfId, { page, cards: split.crops.length });
    }
    if (split.blank) return saveResult(pdfId, { page, cards: 0, note: "blank page" });
    // No card found: keep the whole page as one scan and hold it for a look (never dropped).
    const flag = `PDF page ${page}: no card edge found, check the crop`;
    await storeBatchFiles(batchId, [
      { name: `${stem}-p${String(page).padStart(3, "0")}-page.jpg`, buf: new Uint8Array(split.whole), meta: { ...base, pairKey: `pdf${p.hash.slice(0, 10)}-p${page}-0`, flag } },
    ]);
    return saveResult(pdfId, { page, cards: 1, note: "no card edge found" });
  } catch (e) {
    console.error("pdf page failed", page, e);
    return saveResult(pdfId, { page, cards: 0, note: `couldn't read this page (${e instanceof Error ? e.message.slice(0, 80) : "error"})` });
  }
}

/** "12 cards from this PDF, 2 need a look (pages 3, 7)" for every PDF in a batch. */
export async function pdfSummaries(batchId: string) {
  const pdfs = await db.pdfIngest.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const p of pdfs) {
    const results = JSON.parse(p.results) as PageResult[];
    const files = await db.uploadFile.findMany({ where: { batchId, sheetHash: p.hash, side: "front" }, select: { page: true, cardId: true } });
    const cards = await db.card.findMany({
      where: { id: { in: files.map((f) => f.cardId).filter((x): x is string => !!x) } },
      select: { id: true, status: true, holdReason: true },
    });
    const pageOf = new Map(files.map((f) => [f.cardId, f.page]));
    const look = new Set<number>();
    for (const c of cards) if (c.status === "NeedsLook" || c.status === "Inbox" || c.holdReason) look.add(pageOf.get(c.id) ?? 0);
    for (const r of results) if (r.note && r.note !== "blank page") look.add(r.page);
    look.delete(0);
    const needLook = cards.filter((c) => c.status === "NeedsLook" || c.status === "Inbox" || c.holdReason).length + results.filter((r) => r.note && r.cards === 0 && r.note !== "blank page").length;
    out.push({
      id: p.id,
      name: p.name,
      pages: p.pages,
      split: results.length,
      cards: cards.length,
      needLook,
      lookPages: [...look].sort((a, b) => a - b),
      blankPages: results.filter((r) => r.note === "blank page").map((r) => r.page),
      line: `${cards.length} card${cards.length === 1 ? "" : "s"} from this PDF, ${needLook} need${needLook === 1 ? "s" : ""} a look${look.size ? ` (page${look.size === 1 ? "" : "s"} ${[...look].sort((a, b) => a - b).join(", ")})` : ""}`,
    });
  }
  return out;
}
