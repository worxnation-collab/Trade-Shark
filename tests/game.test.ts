import { describe, expect, it } from "vitest";
import {
  CHASE_RATE,
  drawPack,
  drawPacks,
  HARD_CAP,
  nextLocalMidnight,
  oddsLines,
  PRICES,
  RULES_LINE,
  rollChase,
  showable,
  shortages,
  slotOf,
  sumValue,
  TARGET,
  type PoolCard,
  type Rng,
} from "@/lib/game/rules";

/** A seeded RNG so draws are repeatable. */
function seeded(seed = 7): Rng {
  let s = seed >>> 0;
  return (n) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}
const many = (n: number, price: number, p: string): PoolCard[] => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, price }));

// Every draw from this pool is 8×0.10 + 3×0.30 + 1.00 = $2.70: over the band.
const overBand = () => [...many(40, 0.1, "b"), ...many(15, 0.3, "m"), ...many(5, 1, "t")];
// 8×0.05 + 3×0.30 + 0.75 = $2.05: inside it.
const fitting = () => [...many(40, 0.05, "b"), ...many(15, 0.3, "m"), ...many(5, 0.75, "t")];

describe("value bins", () => {
  it("bulk < $0.25 ≤ mid < $0.75 ≤ top ≤ $2; $10+ is chase; $2.01–$9.99 never packs", () => {
    expect(slotOf(0.24)).toBe("bulk");
    expect(slotOf(0.25)).toBe("mid");
    expect(slotOf(0.74)).toBe("mid");
    expect(slotOf(0.75)).toBe("top");
    expect(slotOf(2)).toBe("top");
    expect(slotOf(2.01)).toBe(null);
    expect(slotOf(9.99)).toBe(null);
    expect(slotOf(10)).toBe("chase");
    expect(slotOf(null)).toBe(null);
  });
});

describe("pack builder", () => {
  it("draws 8 bulk + 3 mid + 1 top, one category's pool, value inside $1.80–$2.40", () => {
    const p = drawPack(fitting(), seeded())!;
    expect(p.ids).toHaveLength(12);
    expect(new Set(p.ids).size).toBe(12);
    expect(p.ids.filter((id) => id.startsWith("b"))).toHaveLength(8);
    expect(p.ids.filter((id) => id.startsWith("m"))).toHaveLength(3);
    expect(p.ids.filter((id) => id.startsWith("t"))).toHaveLength(1);
    expect(p.value).toBeGreaterThanOrEqual(TARGET.min);
    expect(p.value).toBeLessThanOrEqual(TARGET.max);
  });

  it("rejects draws that miss the band and draws again; gives up rather than pad", () => {
    expect(drawPack(overBand(), seeded())).toBe(null);
    // Mixed tops: only the cheap ones fit, so the builder keeps drawing until it lands one.
    const mixed = [...many(40, 0.05, "b"), ...many(15, 0.3, "m"), ...many(4, 2, "x"), ...many(1, 0.8, "t")];
    const p = drawPack(mixed, seeded(3))!;
    expect(p.ids).toContain("t0");
    expect(p.value).toBe(2.1);
  });

  it("a slot it can't fill leaves the category unable to start, never a wrong-value pad", () => {
    const noTop = [...many(40, 0.05, "b"), ...many(15, 0.3, "m"), ...many(3, 5, "x")];
    expect(drawPack(noTop, seeded())).toBe(null);
    expect(shortages(noTop)).toEqual([{ slot: "top", have: 0, need: 1 }]);
    expect(shortages(fitting())).toEqual([]);
  });

  it("$10+ cards never land in a normal pack", () => {
    const withChase = [...fitting(), ...many(5, 50, "c")];
    for (const p of drawPacks(withChase, 10, seeded())) expect(p.ids.some((id) => id.startsWith("c"))).toBe(false);
  });

  it("draws as many packs as the bins allow, each card once", () => {
    const packs = drawPacks(fitting(), 50, seeded());
    expect(packs).toHaveLength(5); // 5 tops
    expect(new Set(packs.flatMap((p) => p.ids)).size).toBe(60);
  });

  it("never shows a normal pack over $3.50 or outside the band; a chase pack may go over", () => {
    expect(showable({ value: 2.0, chase: false })).toBe(true);
    expect(showable({ value: 2.5, chase: false })).toBe(false);
    expect(showable({ value: HARD_CAP + 1, chase: false })).toBe(false);
    expect(showable({ value: 14, chase: true })).toBe(true);
    expect(sumValue([0.1, 0.2])).toBe(0.3);
  });

  it("chase is about 1 in 25, the same roll for peek and blind", () => {
    let hits = 0;
    const rng = seeded(11);
    for (let i = 0; i < 25000; i++) if (rollChase(rng)) hits++;
    expect(CHASE_RATE).toBe(25);
    expect(hits / 25000).toBeGreaterThan(0.035);
    expect(hits / 25000).toBeLessThan(0.045);
  });
});

describe("game copy and prices", () => {
  it("the rules sentence and prices", () => {
    expect(RULES_LINE).toBe("$1 to reveal. Keep for $2.99 more. Pass, or let the timer end, and the only option left is a $4.99 pack you see after you pay.");
    expect(PRICES).toEqual({ reveal: 1, keepMore: 2.99, keepTotal: 3.99, blind: 4.99 });
    expect(PRICES.reveal + PRICES.keepMore).toBeCloseTo(PRICES.keepTotal, 10);
  });

  it("odds: the same five lines for peek and blind; the chase line follows the flag", () => {
    const base = [
      "8 of 12 cards are bulk, usually under $0.25",
      "3 are modest, usually $0.25 to $0.75",
      "1 is the best card in the pack, usually $0.75 to $2",
      "Pack value is usually under the keep price",
    ];
    expect(oddsLines(false)).toEqual([...base, "Chase cards are not in packs until that feature is turned on"]);
    expect(oddsLines(true)).toEqual([...base, "About 1 in 25 packs contains a card priced at $10 or more."]);
  });
});

describe("lock until local midnight", () => {
  it("ends at the player's next midnight, DST included", () => {
    // 9 pm in New York (EDT, UTC-4) on Oct 5 → midnight Oct 6 local = 04:00 UTC.
    expect(nextLocalMidnight(new Date("2026-10-06T01:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-06T04:00:00.000Z");
    // 1 am local, just after midnight → the next one, ~23 h away.
    expect(nextLocalMidnight(new Date("2026-10-06T05:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-07T04:00:00.000Z");
    // The night DST ends (Nov 1 2026): midnight Nov 2 is EST (UTC-5).
    expect(nextLocalMidnight(new Date("2026-11-01T12:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(nextLocalMidnight(new Date("2026-10-06T01:00:00Z"), "Asia/Tokyo").toISOString()).toBe("2026-10-06T15:00:00.000Z");
    // A junk zone falls back to New York.
    expect(nextLocalMidnight(new Date("2026-10-06T01:00:00Z"), "Not/AZone").toISOString()).toBe("2026-10-06T04:00:00.000Z");
  });
});
