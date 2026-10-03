import { describe, expect, it } from "vitest";
import { LIL_STACK_SIZE, LIL_STACK_UNDER, packLabel, planPacks, qualifies } from "@/lib/lilStack";
import { statusAfterPricing } from "@/lib/pricing/engine";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";

const card = (o: Partial<Parameters<typeof qualifies>[0]> = {}) => ({
  id: "c",
  status: "BulkHold",
  listPrice: 0.5,
  readable: true,
  frontImage: "b/f.jpg",
  pile: "none",
  ...o,
});

describe("Lil' Stack", () => {
  it("threshold is under $1.00: $0.99 goes in, $1.00 stays a single", () => {
    expect(LIL_STACK_UNDER).toBe(1);
    expect(qualifies(card({ listPrice: 0.99 }))).toBe(true);
    expect(qualifies(card({ listPrice: 1 }))).toBe(false);
    expect(qualifies(card({ listPrice: null }))).toBe(false);
  });

  it("only packs priced cards with a photo, never owner decisions or rescans", () => {
    expect(qualifies(card({ status: "Priced" }))).toBe(true);
    expect(qualifies(card({ status: "LilStack" }))).toBe(true);
    for (const status of ["Inbox", "Identified", "Ready", "Listed", "Sold", "Archived"]) expect(qualifies(card({ status }))).toBe(false);
    expect(qualifies(card({ readable: false }))).toBe(false);
    expect(qualifies(card({ frontImage: null }))).toBe(false);
    expect(qualifies(card({ pile: "duplicate" }))).toBe(false);
  });

  it("packs hold up to 12, extras make pack 2, 3…", () => {
    const ids = Array.from({ length: 27 }, (_, i) => `c${i}`);
    const packs = planPacks(ids);
    expect(LIL_STACK_SIZE).toBe(12);
    expect(packs.map((p) => p.length)).toEqual([12, 12, 3]);
    expect(new Set(packs.flat()).size).toBe(27); // each card in exactly one pack
    expect(planPacks([])).toEqual([]);
    expect([1, 2, 3].map(packLabel)).toEqual(["Lil' Stack", "Lil' Stack 2", "Lil' Stack 3"]);
  });

  it("a packed card stays packed under $1 and comes out at $1+", () => {
    expect(statusAfterPricing("LilStack", 0.4, true, S)).toBe("LilStack");
    expect(statusAfterPricing("LilStack", 1, true, S)).toBe("BulkHold"); // $1–$2 is still Bulk Hold
    expect(statusAfterPricing("LilStack", 5, true, S)).toBe("Priced");
    // A fresh sub-$1 card waits in Bulk Hold until the packer picks it up.
    expect(statusAfterPricing("Identified", 0.5, true, S)).toBe("BulkHold");
  });
});
