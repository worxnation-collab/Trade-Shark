/**
 * Browser-side batch upload, shared by the regular upload page and the flatbed split.
 * Supabase mode: signed upload URL → PUT straight to private storage → register path with the server.
 * Local mode: small multipart chunks.
 */

export interface UploadItem {
  file: Blob;
  name: string;
  meta?: Record<string, unknown>;
}

export interface Registered {
  id: string;
  name: string;
  rel: string;
  hash: string;
}

async function post(url: string, body?: BodyInit, json = false) {
  const res = await fetch(url, { method: "POST", body, headers: json ? { "Content-Type": "application/json" } : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json();
}

export const postJson = (url: string, body: unknown) => post(url, JSON.stringify(body), true);

/** A new upload. Every card in it belongs to `owner` ("f:<founder>" or "s:<sender id>", required). */
export async function createBatch(name: string, owner: string): Promise<string> {
  return (await postJson("/api/admin/batches", { name, owner })).id;
}

/** Upload in chunks of 4 so each server call stays well inside serverless time/size limits. */
export async function uploadItems(batchId: string, items: UploadItem[], onProgress?: (done: number, total: number) => void) {
  const out: Registered[] = [];
  const CHUNK = 4;
  for (let i = 0; i < items.length; i += CHUNK) {
    onProgress?.(i, items.length);
    const chunk = items.slice(i, i + CHUNK);
    const urls = await postJson(`/api/admin/batches/${batchId}/upload-urls`, { names: chunk.map((p) => p.name) });
    let r;
    if (urls.mode === "direct") {
      await Promise.all(
        chunk.map(async (p, j) => {
          const res = await fetch(urls.items[j].signedUrl, {
            method: "PUT",
            headers: { "Content-Type": p.file.type || "application/octet-stream", "x-upsert": "true" },
            body: p.file,
          });
          if (!res.ok) throw new Error(`Upload failed for ${p.name}: ${res.status}`);
        }),
      );
      r = await postJson(`/api/admin/batches/${batchId}/files`, {
        items: chunk.map((p, j) => ({ name: p.name, rel: urls.items[j].rel, meta: p.meta })),
      });
    } else {
      const fd = new FormData();
      for (const p of chunk) {
        fd.append("files", p.file, p.name);
        fd.append("names", p.name);
        fd.append("meta", p.meta ? JSON.stringify(p.meta) : "");
      }
      r = await post(`/api/admin/batches/${batchId}/files`, fd);
    }
    out.push(...(r.files ?? []));
  }
  onProgress?.(items.length, items.length);
  return out;
}

export async function organize(batchId: string, body: { pairMode: string; manifest?: string; pastedLines?: string }) {
  return postJson(`/api/admin/batches/${batchId}/organize`, body) as Promise<{ cards: number; files: number }>;
}

/** Identify + price one card per request until the batch is done. */
export async function processAll(batchId: string, total: number, onProgress?: (done: number, total: number) => void) {
  let remaining = total;
  while (remaining > 0) {
    onProgress?.(total - remaining, total);
    const r = await post(`/api/admin/batches/${batchId}/process?limit=1`);
    remaining = r.remaining;
    if (!r.processed) break;
  }
  onProgress?.(total, total);
}

/**
 * A PDF of scanned cards: register it by hash (skipped if ingested before), then render and split it page by page in
 * the browser, uploading each page's images as soon as they're ready. Unreadable pages are recorded, not dropped.
 */
export async function uploadPdf(
  batchId: string,
  file: File,
  o: { pdfjsVersion: string; cvSrc: string; onPage?: (page: number, pages: number) => void },
): Promise<{ name: string; skipped?: string; pages: number; failed: number[] }> {
  const { pdfPageCount, sha256, splitPdf } = await import("./pdfSplit");
  const hash = await sha256(file);
  const pages = await pdfPageCount(file, o.pdfjsVersion);
  const reg = await postJson(`/api/admin/batches/${batchId}/pdf`, { name: file.name, hash, pages });
  if (reg.skipped) return { name: file.name, skipped: reg.batchName, pages: reg.pages, failed: [] };
  const r = await splitPdf(file, { ...o, hash, pdfId: reg.pdfId, send: (items) => uploadItems(batchId, items) });
  for (const f of r.failed) await postJson(`/api/admin/batches/${batchId}/pdf/${reg.pdfId}`, f).catch(() => null);
  return { name: file.name, pages: r.pages, failed: r.failed.map((f) => f.page) };
}

/** Hand the stored upload to the background queue. Returns e.g. "19 pages received." */
export async function queueBatch(batchId: string, body: { pairMode: string; manifest?: string; pastedLines?: string }) {
  return postJson(`/api/admin/batches/${batchId}/queue`, body) as Promise<{ message: string; pages: number; images: number }>;
}
