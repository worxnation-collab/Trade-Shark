import { createHash } from "node:crypto";
import { db } from "./db";
import { refreshPacks } from "./lilStack";
import { organizeBatch, processCard, type OrganizeInput } from "./pipeline";

/**
 * Background ingest. An upload only stores files and answers ("19 pages received"); the work happens here, a unit at
 * a time: split the next PDF page (crop), then for each new card: orient → identify → price → bin. A card is on the
 * desk as soon as it is priced. Ticks come from the open desk / batch page and from a scheduled function (every
 * minute), so it keeps going with the browser closed. One worker per batch at a time (ingestLockUntil).
 */
const LOCK_MS = 40_000;

export const tickKey = () => createHash("sha256").update(`ingest:${process.env.INGEST_KEY || process.env.TRADE_SHARK_PASSWORD || ""}`).digest("hex");

/** Mark a batch for background processing. Returns what was received. */
export async function queueBatch(batchId: string, opts: OrganizeInput) {
  const [images, pdfs] = await Promise.all([
    db.uploadFile.count({ where: { batchId, OR: [{ side: null }, { side: { not: "sheet" } }], sheetHash: null } }),
    db.pdfIngest.findMany({ where: { batchId }, select: { pages: true } }),
  ]);
  const pages = pdfs.reduce((n, p) => n + p.pages, 0);
  await db.batch.update({ where: { id: batchId }, data: { ingestState: "queued", ingestOptions: JSON.stringify(opts), pairMode: opts.pairMode } });
  const parts = [pages ? `${pages} page${pages === 1 ? "" : "s"}` : null, images ? `${images} image${images === 1 ? "" : "s"}` : null].filter(Boolean);
  return { pages, images, message: `${parts.join(" and ") || "Nothing"} received.` };
}

async function claim(batchId: string, now: Date) {
  const n = await db.batch.updateMany({
    where: { id: batchId, ingestState: "queued", OR: [{ ingestLockUntil: null }, { ingestLockUntil: { lt: now } }] },
    data: { ingestLockUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return n.count === 1;
}

/** One unit of work for a batch. Returns false when the batch has nothing left. */
async function step(batchId: string): Promise<boolean> {
  const b = await db.batch.findUniqueOrThrow({ where: { id: batchId } });
  const opts = JSON.parse(b.ingestOptions ?? "{}") as OrganizeInput;
  // 1) Files not made into cards yet (PDF pages arrive already cropped / trimmed by the upload).
  // 2) Image files not made into cards yet (pairing needs the whole set, so they're all uploaded by now).
  if (await db.uploadFile.count({ where: { batchId, cardId: null, OR: [{ side: null }, { side: { not: "sheet" } }] } })) {
    await organizeBatch(batchId, { pairMode: opts.pairMode ?? "auto", manifest: opts.manifest, pastedLines: opts.pastedLines });
    // Files that can't become cards (e.g. a non-image) would stay unorganized: don't loop on them.
    if (await db.uploadFile.count({ where: { batchId, cardId: null, readable: true, OR: [{ side: null }, { side: { not: "sheet" } }] } })) return false;
    return true;
  }
  // 3) The next card: orient → identify → price → bin, once.
  const card = await db.card.findFirst({ where: { batchId, processedAt: null }, orderBy: { pairId: "asc" }, select: { id: true } });
  if (card) {
    await processCard(card.id);
    return true;
  }
  return false;
}

/** Work through queued batches for up to `budgetMs`. Called by the desk and by the scheduled function. */
export async function tick(budgetMs = 18_000, onlyBatch?: string) {
  const start = Date.now();
  const batches = await db.batch.findMany({ where: { ingestState: "queued", ...(onlyBatch ? { id: onlyBatch } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true } });
  let units = 0;
  for (const { id } of batches) {
    if (Date.now() - start > budgetMs) break;
    if (!(await claim(id, new Date()))) continue; // another worker has it
    try {
      while (Date.now() - start < budgetMs) {
        const more = await step(id);
        if (!more) {
          await db.batch.update({ where: { id }, data: { ingestState: "done" } });
          await refreshPacks().catch(() => null); // sort categories, retire old links
          break;
        }
        units++;
        await db.batch.update({ where: { id }, data: { ingestLockUntil: new Date(Date.now() + LOCK_MS) } });
      }
    } finally {
      await db.batch.update({ where: { id }, data: { ingestLockUntil: null } });
    }
  }
  // New priced cards (or a "List next 10" budget) may make legal packs: list them, within each category's budget.
  if (Date.now() - start < budgetMs) await import("./desk").then((m) => m.autoListAll()).catch((e) => console.error("autoList", e));
  // eBay sold check (throttled to every 5 minutes inside); a failure leaves cards as they are.
  if (Date.now() - start < budgetMs) await import("./ebay/seller").then((m) => m.syncEbaySales()).catch((e) => console.error("ebay sync", e instanceof Error ? e.message : e));
  return { units, progress: await ingestProgress() };
}

/** "4 of 19 priced" for every batch still in the queue. */
export async function ingestProgress() {
  const batches = await db.batch.findMany({ where: { ingestState: "queued" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  return Promise.all(
    batches.map(async (b) => {
      const [cards, priced, looseFiles] = await Promise.all([
        db.card.count({ where: { batchId: b.id } }),
        db.card.count({ where: { batchId: b.id, processedAt: { not: null } } }),
        db.uploadFile.count({ where: { batchId: b.id, cardId: null, readable: true, OR: [{ side: null }, { side: { not: "sheet" } }] } }),
      ]);
      const total = cards + looseFiles;
      return { id: b.id, name: b.name, priced, total, line: `${priced} of ${total} priced` };
    }),
  );
}
