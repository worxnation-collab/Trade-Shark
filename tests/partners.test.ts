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

import { fitsReserve, ownerValue, parseOwner, reserveState } from "@/lib/partners/split";

describe("owners", () => {
  it("a tag is a founder or a sender, never both, never blank", () => {
    expect(parseOwner("f:adrian")).toEqual({ partnerId: "adrian", senderId: null });
    expect(parseOwner("s:cmabc12345")).toEqual({ partnerId: null, senderId: "cmabc12345" });
    expect(parseOwner("f:bob")).toBe(null);
    expect(parseOwner("")).toBe(null);
    expect(ownerValue({ partnerId: "mike" })).toBe("f:mike");
    expect(ownerValue({ senderId: "x1" })).toBe("s:x1");
  });

  it("a consignment card takes no founder share; its part of the net stays with the company", () => {
    // $4.99 blind, $0.44 fee → $4.55 net. Founder cards $3, a $50 consignment card: founders split by $3/$53.
    const shares = splitNet(4.55, [
      { partnerId: "matthew", value: 2 },
      { partnerId: "adrian", value: 1 },
      { partnerId: null, value: 50 }, // consignment: owed $50 from the reserve, no share
    ]);
    expect(shares.map((s) => s.partnerId).sort()).toEqual(["adrian", "matthew"]);
    const founders = shares.reduce((a, s) => a + s.amount, 0);
    expect(founders).toBeCloseTo(0.26, 2); // 4.55 × 3/53
  });
});

describe("reserve", () => {
  it("on hand = balance − payable; headroom also takes off what's already in stacks; shortfall vs every unsold card", () => {
    const r = reserveState({ balance: 120, payable: 20, committed: 30, liability: 150 });
    expect(r.onHand).toBe(100);
    expect(r.headroom).toBe(70);
    expect(r.shortfall).toBe(50);
    expect(reserveState({ balance: 10, payable: 20, committed: 0, liability: 0 }).headroom).toBe(0);
  });

  it("a stack's consignment cards must fit together", () => {
    expect(fitsReserve([50], 70)).toBe(true);
    expect(fitsReserve([50, 25], 70)).toBe(false);
    expect(fitsReserve([], 0)).toBe(true);
  });
});
