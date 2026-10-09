import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
const { ingestKeyOk, receiveFile, MAX_INBOX_BYTES } = await import("@/lib/ingestInbox");

describe("ingest inbox", () => {
  it("accepts only the hashed ingest key", () => {
    process.env.INGEST_KEY = "k-test";
    const good = createHash("sha256").update("ingest:k-test").digest("hex");
    expect(ingestKeyOk(good)).toBe(true);
    expect(ingestKeyOk("k-test")).toBe(false);
    expect(ingestKeyOk(null)).toBe(false);
  });

  it("needs a founder and a file under the limit before touching anything", async () => {
    const buf = new Uint8Array([1, 2, 3]);
    expect(await receiveFile({ name: "a.jpg", buf, owner: "someone" })).toMatchObject({ ok: false, status: 400 });
    expect(await receiveFile({ name: "a.jpg", buf: new Uint8Array(), owner: "matthew" })).toMatchObject({ ok: false, status: 400 });
    expect(await receiveFile({ name: "a.pdf", buf: new Uint8Array(MAX_INBOX_BYTES + 1), owner: "Matthew" })).toMatchObject({ ok: false, status: 413 });
  });
});
