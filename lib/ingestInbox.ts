import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { queueBatch, tickKey } from "./ingestQueue";
import { isPartner, PARTNERS, type PartnerId } from "./partners/split";
import { storeBatchFiles } from "./pipeline";
import { putObject, signedUrl } from "./storage";

/**
 * Files sent from outside the desk (a Google Drive script): POST /api/ingest/upload with the ingest key.
 * Images go straight into the background queue. A PDF can't be split on the server (no WASM in the function), so it
 * waits in the inbox and the pack desk's browser splits it the next time the desk is open; then it runs as usual.
 * Every file is tagged to a founder. The same PDF (sha-256) is never taken twice.
 */
export const MAX_INBOX_BYTES = 5_500_000; // Netlify's request limit is 6 MB

export function ingestKeyOk(header: string | null) {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(tickKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

const isPdf = (buf: Uint8Array) => buf.length > 4 && Buffer.from(buf.subarray(0, 5)).toString("latin1") === "%PDF-";

const today = (now: Date) => now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

async function inboxBatch(partnerId: PartnerId, label: string) {
  const who = PARTNERS.find((p) => p.id === partnerId)!.name;
  const name = `Drive · ${label} · ${who}`;
  const found = await db.batch.findFirst({ where: { name, partnerId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return found ?? (await db.batch.create({ data: { name, partnerId }, select: { id: true } }));
}

export async function receiveFile(input: { name: string; buf: Uint8Array; owner: string; now?: Date }) {
  const owner = input.owner.trim().toLowerCase();
  if (!isPartner(owner)) return { ok: false as const, status: 400, error: "owner must be matthew, adrian or mike" };
  if (!input.buf.length) return { ok: false as const, status: 400, error: "empty file" };
  if (input.buf.length > MAX_INBOX_BYTES) return { ok: false as const, status: 413, error: "file over 5.5 MB; split it or upload on the desk" };
  const name = (input.name || "scan").slice(0, 200);
  const now = input.now ?? new Date();

  if (isPdf(input.buf)) {
    const hash = createHash("sha256").update(input.buf).digest("hex");
    const seen = await db.pdfIngest.findUnique({ where: { hash }, select: { id: true } });
    if (seen) return { ok: true as const, status: 200, skipped: true, message: "Already ingested this PDF." };
    const batch = await inboxBatch(owner, name.replace(/\.pdf$/i, ""));
    const rel = `${batch.id}/inbox/${hash.slice(0, 24)}.pdf`;
    await putObject(rel, input.buf, "application/pdf");
    // pages 0 = waiting for the desk to split it.
    await db.pdfIngest.create({ data: { batchId: batch.id, name, hash, rel, pages: 0 } });
    return { ok: true as const, status: 202, batchId: batch.id, message: "PDF received. It's split the next time the pack desk is open." };
  }

  const batch = await inboxBatch(owner, today(now));
  const stored = await storeBatchFiles(batch.id, [{ name, buf: input.buf }]);
  if (!stored[0]?.readable) return { ok: false as const, status: 415, error: "not a readable image or PDF" };
  const q = await queueBatch(batch.id, { pairMode: "auto" });
  return { ok: true as const, status: 202, batchId: batch.id, message: q.message };
}

/** PDFs from the script still waiting for a browser to split them (oldest first), with a short-lived download link. */
export async function pendingPdfs() {
  const rows = await db.pdfIngest.findMany({ where: { pages: 0, rel: { not: "" } }, orderBy: { createdAt: "asc" }, take: 5 });
  return Promise.all(rows.map(async (r) => ({ id: r.id, batchId: r.batchId, name: r.name, url: await signedUrl(r.rel, 900) })));
}
