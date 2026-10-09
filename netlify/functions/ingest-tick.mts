import { createHash } from "node:crypto";

/**
 * Keeps background ingest moving when nobody has the desk open: every minute, ask the site to work through queued
 * uploads (a few pages / cards per call). The key is derived from the same secret the site uses.
 */
export default async () => {
  const base = process.env.URL || "https://trade-shark.netlify.app";
  const key = createHash("sha256").update(`ingest:${process.env.INGEST_KEY || process.env.TRADE_SHARK_PASSWORD || ""}`).digest("hex");
  const r = await fetch(`${base}/api/ingest/tick`, { method: "POST", headers: { "x-ingest-key": key } }).catch((e) => ({ ok: false, status: String(e) }));
  console.log("ingest tick", r.status);
};

export const config = { schedule: "* * * * *" };
