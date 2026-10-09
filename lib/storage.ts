import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./env";

/**
 * Where scans live.
 * - Supabase Storage (private bucket) when SUPABASE_URL + SUPABASE_SECRET_KEY are set — used on Netlify.
 * - Local disk (DATA_DIR/images) otherwise — handy for local dev.
 * Either way scans are never public: they're served through authenticated routes or short-lived signed URLs.
 */

export const BUCKET = process.env.SUPABASE_BUCKET || "trade-shark-scans";

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return (client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}

export const usingSupabase = () => supabase() !== null;

function localRoot() {
  return path.resolve(process.cwd(), dataDir(), "images");
}

/** Resolve a stored relative path inside the local root; refuses traversal. */
function localPath(rel: string): string | null {
  const root = localRoot();
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export function safeRel(rel: string) {
  return !rel.includes("..") && !rel.startsWith("/") && /^[\w\-./]+$/.test(rel);
}

export async function putObject(rel: string, buf: Uint8Array, contentType: string) {
  if (!safeRel(rel)) throw new Error(`bad storage path ${rel}`);
  const sb = supabase();
  if (sb) {
    const { error } = await sb.storage.from(BUCKET).upload(rel, buf, { contentType, upsert: true });
    if (error) throw new Error(`storage upload: ${error.message}`);
    return;
  }
  const abs = localPath(rel)!;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
}

export async function getObject(rel: string): Promise<Uint8Array | null> {
  if (!safeRel(rel)) return null;
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb.storage.from(BUCKET).download(rel);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  const abs = localPath(rel);
  if (!abs) return null;
  try {
    return new Uint8Array(await readFile(abs));
  } catch {
    return null;
  }
}

/** Short-lived URL for the browser (Supabase only). */
export async function signedUrl(rel: string, seconds = 3600): Promise<string | null> {
  const sb = supabase();
  if (!sb || !safeRel(rel)) return null;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(rel, seconds);
  return error ? null : data.signedUrl;
}

/** Signed upload target so the browser sends big scans straight to storage (skips the 6 MB function limit). */
export async function signedUpload(rel: string) {
  const sb = supabase();
  if (!sb || !safeRel(rel)) return null;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(rel, { upsert: true });
  if (error) throw new Error(`signed upload: ${error.message}`);
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}
