import { describe, expect, it } from "vitest";
import { estimateFee, isPartner, PARTNERS, splitNet } from "@/lib/partners/split";

describe("partner split", () => {
  it("the spec example: $3.99 keep, $0.20 fee, Adrian holds 25% of the engine value → $0.95", () => {
    const shares = splitNet(3.79, [
      { partnerId: "adrian", value: 1 },
      { partnerId: "mike", value: 3 },
    ]);
    expect(shares.find((s) => s.partnerId === "adrian")!.amount).toBe(0.95);
    expect(shares.reduce((a, s) => a + s.amount, 0)).toBeCloseTo(3.79, 10);
  });

  it("sums each partner's cards; shares always add up to the net, leftover cent to the largest share", () => {
    // Thirds of $1.00: 33 + 33 + 33 = 99, the extra cent goes to the biggest holder.
    const shares = splitNet(1, [
      { partnerId: "matthew", value: 0.5 },
      { partnerId: "matthew", value: 0.51 },
      { partnerId: "adrian", value: 1 },
      { partnerId: "mike", value: 1 },
    ]);
    expect(shares.map((s) => s.amount).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(shares.find((s) => s.partnerId === "matthew")!.amount).toBe(0.34);
    expect(shares.find((s) => s.partnerId === "matthew")!.value).toBe(1.01);
  });

  it("one partner owns the whole stack: they get the whole net", () => {
    expect(splitNet(4.5, [{ partnerId: "mike", value: 3.4 }])).toEqual([{ partnerId: "mike", value: 3.4, amount: 4.5 }]);
  });

  it("a card with no partner (old stacks only): the shop keeps that share, partners get theirs", () => {
    const shares = splitNet(4, [
      { partnerId: null, value: 3 },
      { partnerId: "adrian", value: 1 },
    ]);
    expect(shares).toEqual([{ partnerId: "adrian", value: 1, amount: 1 }]);
  });

  it("nothing to split: no rows", () => {
    expect(splitNet(0, [{ partnerId: "mike", value: 1 }])).toEqual([]);
    expect(splitNet(3, [{ partnerId: "mike", value: 0 }])).toEqual([]);
  });

  it("three partners, fee estimate fallback", () => {
    expect(PARTNERS.map((p) => p.name)).toEqual(["Matthew", "Adrian", "Mike"]);
    expect(isPartner("adrian")).toBe(true);
    expect(isPartner("bob")).toBe(false);
    expect(estimateFee(3.99)).toBe(0.42);
  });
});
