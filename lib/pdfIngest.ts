import { db } from "./db";
import { trimToCard } from "./pdf";

/**
 * PDF uploads. The browser renders each page (pdf.js) and crops several-card pages itself (the flatbed detector);
 * a one-card page is sent whole and trimmed to the card here. Every crop is a front scan that goes through the usual
 * background flow (orient → identify → price → owner → bin). A page with no card edge is kept whole and flagged;
 * a blank page is noted; the same PDF (sha-256) is never ingested twice.
 */
export interface PageResult {
  page: number;
  cards: number;
  note?: string; // why this page needs a look
}

/** Register a PDF by its hash. Skipped (with the batch it went into) when this exact file was ingested before. */
export async function registerPdf(batchId: string, name: string, hash: string, pages: number) {
  const seen = await db.pdfIngest.findUnique({ where: { hash } });
  // A PDF from the Drive inbox (pages 0) is claimed by the first browser that splits it.
  if (seen && seen.pages === 0 && seen.batchId === batchId) {
    const claimed = await db.pdfIngest.updateMany({ where: { id: seen.id, pages: 0 }, data: { pages } });
    if (claimed.count) return { skipped: false as const, pdfId: seen.id, pages };
  }
  if (seen) {
    const b = await db.batch.findUnique({ where: { id: seen.batchId }, select: { name: true } });
    return { skipped: true as const, pdfId: seen.id, pages: seen.pages, batchName: b?.name ?? "an earlier batch" };
  }
  const p = await db.pdfIngest.create({ data: { batchId, name, hash, rel: "", pages } });
  return { skipped: false as const, pdfId: p.id, pages };
}

/** Add to one page's result (cards found, or why it needs a look). */
export async function recordPdfPage(pdfId: string, page: number, add: { cards?: number; note?: string }) {
  const p = await db.pdfIngest.findUnique({ where: { id: pdfId } });
  if (!p) return;
  const list = JSON.parse(p.results) as PageResult[];
  const cur = list.find((x) => x.page === page) ?? { page, cards: 0 };
  const next = { ...cur, cards: cur.cards + (add.cards ?? 0), note: add.note ?? cur.note };
  const out = [...list.filter((x) => x.page !== page), next].sort((a, b) => a.page - b.page);
  await db.pdfIngest.update({ where: { id: pdfId }, data: { results: JSON.stringify(out) } });
}

/**
 * A whole page sent by the browser: trim it to the card. Returns the image to store and its flag, or null for a
 * blank page (noted, nothing stored).
 */
export async function preparePdfPage(buf: Uint8Array, page: number) {
  const t = await trimToCard(buf).catch(() => null);
  if (t?.blank) return null;
  if (t) return { buf: new Uint8Array(t.jpeg), box: t.box, flag: undefined as string | undefined };
  return { buf, box: undefined, flag: `PDF page ${page}: no card edge found, check the crop` };
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
    const needs = (c: { status: string; holdReason: string | null }) => c.status === "NeedsLook" || c.status === "Inbox" || !!c.holdReason;
    const look = new Set<number>();
    for (const c of cards) if (needs(c)) look.add(pageOf.get(c.id) ?? 0);
    const failed = results.filter((r) => r.note && r.note !== "blank page" && r.cards === 0);
    for (const r of failed) look.add(r.page);
    look.delete(0);
    const needLook = cards.filter(needs).length + failed.length;
    const pagesList = [...look].sort((a, b) => a - b);
    out.push({
      id: p.id,
      name: p.name,
      pages: p.pages,
      cards: cards.length,
      needLook,
      lookPages: pagesList,
      blankPages: results.filter((r) => r.note === "blank page").map((r) => r.page),
      line: `${cards.length} card${cards.length === 1 ? "" : "s"} from this PDF, ${needLook} need${needLook === 1 ? "s" : ""} a look${pagesList.length ? ` (page${pagesList.length === 1 ? "" : "s"} ${pagesList.join(", ")})` : ""}`,
    });
  }
  return out;
}
