import { describe, expect, it } from "vitest";
import {
  drawPack,
  drawPacks,
  HARD_CAP,
  nextLocalMidnight,
  oddsLines,
  PRICES,
  RULES_LINE,
  nextKind,
  showable,
  shortages,
  slotOf,
  sumValue,
  TARGET,
  type PackKind,
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
  it("bulk < $0.25 ≤ mid < $0.75 ≤ top ≤ $2 < bump < $4 ≤ hit < $10 ≤ chase", () => {
    expect(slotOf(0.24)).toBe("bulk");
    expect(slotOf(0.25)).toBe("mid");
    expect(slotOf(0.74)).toBe("mid");
    expect(slotOf(0.75)).toBe("top");
    expect(slotOf(2)).toBe("top");
    expect(slotOf(2.01)).toBe("bump");
    expect(slotOf(9.99)).toBe("hit");
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

  it("$10+ and $4+ cards never land in a base pack", () => {
    const withChase = [...fitting(), ...many(5, 50, "c"), ...many(5, 6, "h")];
    for (const p of drawPacks(withChase, 10, seeded())) expect(p.ids.some((id) => id.startsWith("c") || id.startsWith("h"))).toBe(false);
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
    expect(showable({ value: 14, kind: "chase" })).toBe(true);
    expect(sumValue([0.1, 0.2])).toBe(0.3);
  });

  it("hit packs: 8 bulk + 3 mid + one $4–$9.99 card, summed $5–$11", () => {
    const pool = [...fitting(), ...many(3, 6, "h"), ...many(2, 12, "x")];
    const p = drawPack(pool, seeded(), 400, "hit")!;
    expect(p.ids.filter((id) => id.startsWith("h"))).toHaveLength(1);
    expect(p.ids.filter((id) => id.startsWith("t") || id.startsWith("x"))).toHaveLength(0);
    expect(p.value).toBeGreaterThanOrEqual(5);
    expect(p.value).toBeLessThanOrEqual(11);
    // A $9.99 hit with $0.24 bulk and $0.74 mid would be $14.13: over the band, never built.
    expect(drawPack([...many(8, 0.24, "b"), ...many(3, 0.74, "m"), ...many(1, 9.99, "h")], seeded(), 50, "hit")).toBe(null);
    expect(slotOf(4)).toBe("hit");
    expect(slotOf(3.99)).toBe("bump");
    expect(showable({ value: 6.5, kind: "hit" })).toBe(true);
    expect(showable({ value: 12, kind: "hit" })).toBe(false);
  });
});

describe("pack mix", () => {
  /** Build `n` packs in a row with the mix rule and an always-stocked pool. */
  function run(n: number, o: { chaseOn: boolean; hitCards?: boolean; readyCap?: boolean }) {
    const recent: PackKind[] = [];
    const counts = { base: 0, hit: 0, chase: 0 };
    for (let i = 0; i < n; i++) {
      const k = nextKind({ recent, ready: { total: o.readyCap ? 10 : 0, hit: o.readyCap ? 3 : 0 }, hitCards: o.hitCards ?? true, chaseOn: o.chaseOn, chaseCards: true });
      recent.unshift(k);
      counts[k]++;
    }
    return { counts, last100: recent.slice(0, 100) };
  }

  it("80 base / 18 hit / 2 chase over the last 100, chase only with the flag on", () => {
    const on = run(400, { chaseOn: true }).last100;
    expect(on.filter((k) => k === "hit")).toHaveLength(18);
    expect(on.filter((k) => k === "chase")).toHaveLength(2);
    expect(on.filter((k) => k === "base")).toHaveLength(80);
    const off = run(400, { chaseOn: false }).last100;
    expect(off.filter((k) => k === "chase")).toHaveLength(0);
    expect(off.filter((k) => k === "hit")).toHaveLength(18);
  });

  it("stops placing $4+ cards past 20% of the last 100 or a fifth of the ready queue", () => {
    const heavy: PackKind[] = [...Array(25).fill("hit"), ...Array(74).fill("base")];
    expect(nextKind({ recent: heavy, ready: { total: 0, hit: 0 }, hitCards: true, chaseOn: false, chaseCards: false })).toBe("base");
    expect(run(200, { chaseOn: false, readyCap: true }).counts.hit).toBe(0); // 3 of 10 ready are already hits
    expect(run(200, { chaseOn: false, hitCards: false }).counts.hit).toBe(0); // no $4+ cards in stock
  });

  it("a kept hit still counts: the window is every built pack, whatever happened to it", () => {
    const recent: PackKind[] = [...Array(18).fill("hit"), ...Array(81).fill("base")];
    expect(nextKind({ recent, ready: { total: 0, hit: 0 }, hitCards: true, chaseOn: false, chaseCards: false })).toBe("base");
  });
});

describe("game copy and prices", () => {
  it("the rules sentence and prices", () => {
    expect(RULES_LINE).toBe("$1 to reveal. Keep for $2.99 more. Pass, or let the timer end, and the only option left is a $4.99 pack you see after you pay.");
    expect(PRICES).toEqual({ reveal: 1, keepMore: 2.99, keepTotal: 3.99, blind: 4.99 });
    expect(PRICES.reveal + PRICES.keepMore).toBeCloseTo(PRICES.keepTotal, 10);
  });

  it("odds: the same lines for peek and blind; the hit line always, the $10 line only with chase on", () => {
    const base = [
      "8 of 12 cards are bulk, usually under $0.25",
      "3 are modest, usually $0.25 to $0.75",
      "1 is the best card in the pack, usually $0.75 to $2",
      "Pack value is usually under the keep price",
      "About 18 in 100 packs contain a card priced from $4 to $10.",
    ];
    expect(oddsLines(false)).toEqual([...base, "Chase cards are not in packs until that feature is turned on"]);
    expect(oddsLines(true)).toEqual([...base, "About 2 in 100 packs contain a card priced at $10 or more."]);
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
