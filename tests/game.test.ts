import { describe, expect, it } from "vitest";
import {
  drawPack,
  drawPacks,
  HARD_CAP,
  HIT_TARGET,
  isBump,
  LOOKS_PER_DAY,
  nextLocalMidnight,
  oddsLines,
  KEEP_LADDER,
  PRICES,
  keepCharge,
  keepPriceFor,
  nextLookNumber,
  RULES_LINE,
  nextKind,
  showable,
  shortages,
  slotOf,
  sumValue,
  TARGET,
  TIMER_SECONDS,
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

// Every draw from this pool is 7×0.10 + 4×0.40 + 2.00 = $4.30: over the band.
const overBand = () => [...many(40, 0.1, "b"), ...many(20, 0.4, "m"), ...many(5, 2, "t")];
// 7×0.10 + 4×0.50 + 1.00 = $3.70: inside it.
const fitting = () => [...many(40, 0.1, "b"), ...many(20, 0.5, "m"), ...many(5, 1, "t")];

describe("value bins", () => {
  it("bulk < $0.25 ≤ mid < $1 ≤ top < $4 ≤ hit < $10 ≤ chase", () => {
    expect(slotOf(0.24)).toBe("bulk");
    expect(slotOf(0.25)).toBe("mid");
    expect(slotOf(0.99)).toBe("mid");
    expect(slotOf(1)).toBe("top");
    expect(slotOf(3.99)).toBe("top");
    expect(slotOf(4)).toBe("hit");
    expect(slotOf(9.99)).toBe("hit");
    expect(slotOf(10)).toBe("chase");
    expect(slotOf(null)).toBe(null);
    expect(isBump(2.5)).toBe(true);
    expect(isBump(2)).toBe(false);
    expect(isBump(4)).toBe(false);
  });
});

describe("pack builder", () => {
  it("draws 7 bulk + 4 mid + 1 top, value inside $3.20–$3.80 (close to the $3.99 keep)", () => {
    expect(TARGET).toEqual({ min: 3.2, max: 3.8 });
    const p = drawPack(fitting(), seeded())!;
    expect(p.ids).toHaveLength(12);
    expect(new Set(p.ids).size).toBe(12);
    expect(p.ids.filter((id) => id.startsWith("b"))).toHaveLength(7);
    expect(p.ids.filter((id) => id.startsWith("m"))).toHaveLength(4);
    expect(p.ids.filter((id) => id.startsWith("t"))).toHaveLength(1);
    expect(p.value).toBeGreaterThanOrEqual(TARGET.min);
    expect(p.value).toBeLessThanOrEqual(TARGET.max);
  });

  it("rejects draws that miss the band and draws again; gives up rather than pad", () => {
    expect(drawPack(overBand(), seeded())).toBe(null);
    // Mixed tops: only the $1.50 one fits, so the builder keeps drawing until it lands it.
    const mixed = [...many(40, 0.1, "b"), ...many(20, 0.4, "m"), ...many(4, 3.5, "x"), ...many(1, 1.5, "t")];
    const p = drawPack(mixed, seeded(3))!;
    expect(p.ids).toContain("t0");
    expect(p.value).toBe(3.8);
  });

  it("a slot it can't fill leaves the category unable to start, never a wrong-value pad", () => {
    const noTop = [...many(40, 0.1, "b"), ...many(20, 0.5, "m"), ...many(3, 5, "x")];
    expect(drawPack(noTop, seeded())).toBe(null);
    expect(shortages(noTop)).toEqual([{ slot: "top", have: 0, need: 1 }]);
    expect(shortages(fitting())).toEqual([]);
  });

  it("no card over $3.99 ever lands in a base pack", () => {
    const withBig = [...fitting(), ...many(5, 50, "c"), ...many(5, 6, "h"), ...many(5, 4, "f")];
    for (const p of drawPacks(withBig, 10, seeded())) expect(p.ids.some((id) => /^[chf]/.test(id))).toBe(false);
  });

  it("draws as many packs as the bins allow, each card once", () => {
    const packs = drawPacks(fitting(), 50, seeded());
    expect(packs).toHaveLength(5); // 5 tops
    expect(new Set(packs.flatMap((p) => p.ids)).size).toBe(60);
  });

  it("never shows a base pack outside the band; a chase pack may go over", () => {
    expect(showable({ value: 3.5, chase: false })).toBe(true);
    expect(showable({ value: 2.4, chase: false })).toBe(false);
    expect(showable({ value: HARD_CAP + 0.1, chase: false })).toBe(false);
    expect(showable({ value: 14, kind: "chase" })).toBe(true);
    expect(sumValue([0.1, 0.2])).toBe(0.3);
  });

  it("hit packs: 7 bulk + 4 mid + one $4–$9.99 card", () => {
    const pool = [...fitting(), ...many(3, 6, "h"), ...many(2, 12, "x")];
    const p = drawPack(pool, seeded(), 400, "hit")!;
    expect(p.ids.filter((id) => id.startsWith("h"))).toHaveLength(1);
    expect(p.ids.filter((id) => id.startsWith("b"))).toHaveLength(7);
    expect(p.ids.filter((id) => id.startsWith("m"))).toHaveLength(4);
    expect(p.ids.filter((id) => id.startsWith("t") || id.startsWith("x"))).toHaveLength(0);
    expect(p.value).toBeGreaterThanOrEqual(HIT_TARGET.min);
    expect(p.value).toBeLessThanOrEqual(HIT_TARGET.max);
    expect(showable({ value: 6.5, kind: "hit" })).toBe(true);
    expect(showable({ value: 13, kind: "hit" })).toBe(false);
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
  it("looking is free: the rules sentence, a 120 s clock, 3 looks a day", () => {
    expect(RULES_LINE).toBe("You roll it. You keep it or put it back. Three free rolls a day: the first is $3.99 to keep, the next is $4.99, the last is $5.99.");
    expect(TIMER_SECONDS).toBe(120);
    expect(LOOKS_PER_DAY).toBe(3);
  });

  it("the keep ladder: look 1 $3.99, look 2 $4.99, look 3 $5.99; a new day starts over", () => {
    expect(KEEP_LADDER).toEqual([3.99, 4.99, 5.99]);
    expect(KEEP_LADDER.length).toBe(LOOKS_PER_DAY);
    expect([0, 1, 2].map((used) => keepPriceFor(nextLookNumber(used)))).toEqual([3.99, 4.99, 5.99]);
    expect(keepPriceFor(1)).toBe(3.99);
    expect(keepPriceFor(2)).toBe(4.99);
    expect(keepPriceFor(3)).toBe(5.99);
    expect(keepPriceFor(9)).toBe(5.99);
    // Today's looks expire at local midnight, so the next day's count is 0 again: look 1.
    expect(keepPriceFor(nextLookNumber(0))).toBe(3.99);
  });

  it("dealer's choice is $6.99, above the last look", () => {
    expect(PRICES).toEqual({ blind: 6.99 });
    expect(PRICES.blind).toBeGreaterThan(Math.max(...KEEP_LADDER));
  });

  it("a keep charges the price stored on its cycle and refuses any other amount", () => {
    expect(keepCharge(4.99)).toEqual({ ok: true, amount: 4.99 });
    expect(keepCharge(4.99, 4.99)).toEqual({ ok: true, amount: 4.99 });
    expect(keepCharge(5.99, "5.99")).toEqual({ ok: true, amount: 5.99 });
    for (const asked of [3.99, 5.99, 0, 1, 499, -4.99, "abc", 6.99]) expect(keepCharge(4.99, asked).ok).toBe(false);
    expect(keepCharge(3.99, 4.99)).toEqual({ ok: false, error: "This pack is $3.99 to keep." });
    // A cycle shown before the ladder existed was a look-1 $3.99 pack.
    expect(keepCharge(null)).toEqual({ ok: true, amount: 3.99 });
  });

  it("odds: never says what a pack is worth; chase only when it's on", () => {
    const base = ["11 cards are under $1.", "1 is the best card in the pack.", "About 1 in 5 packs, that best card is $4 or more."];
    const raw = "Raw, as scanned. Sleeved and top-loaded. Not for grading.";
    expect(oddsLines(false)).toEqual([...base, raw]);
    expect(oddsLines(false).join(" ")).not.toMatch(/chase|\$10|worth|3\.99/i);
    expect(oddsLines(true)).toEqual([...base, "About 2 in 100 packs contain a card priced at $10 or more.", raw]);
  });
});

describe("the daily look count resets at local midnight", () => {
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
