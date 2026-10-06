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

/** A new upload. Every card in it belongs to `partnerId` (required). */
export async function createBatch(name: string, partnerId: string): Promise<string> {
  return (await postJson("/api/admin/batches", { name, partnerId })).id;
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
