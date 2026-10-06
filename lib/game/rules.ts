/**
 * The reveal game's rules, in one place. Pure: no database, no Stripe. The UI and the server read the same numbers.
 * Card values are the existing engine price (Card.listPrice); nothing here prices a card.
 */

export const PACK_CARDS = 12;
export const SLOTS = { bulk: 8, mid: 3, top: 1 } as const;
export type Slot = keyof typeof SLOTS;

/** Value bins, in dollars. Bulk < 0.25 ≤ mid < 0.75 ≤ top ≤ 2.00. Chase ≥ 10. Anything else never goes in a pack. */
export const BIN = { midFrom: 0.25, topFrom: 0.75, topTo: 2, chaseFrom: 10 } as const;
/** A normal pack's summed value must land here; otherwise the draw is thrown out and drawn again. */
export const TARGET = { min: 1.8, max: 2.4 } as const;
/** Never show or sell a pack above this, unless it's a chase pack. */
export const HARD_CAP = 3.5;

export const PRICES = { reveal: 1, keepMore: 2.99, keepTotal: 3.99, blind: 4.99 } as const;
export const TIMER_SECONDS = 30;
/** When the pack graphic nudges and the Keep button pulses (seconds after the reveal). */
export const NUDGES = [10, 20] as const;
/** Network slack on top of the 30 s before the server refuses a Keep. */
export const KEEP_GRACE_MS = 3000;

export const CHASE_RATE = 25; // about 1 in 25 packs
/** At most this many chase packs reserved at once per category, so one player can't drain the list. */
export const CHASE_RESERVE_CAP = 1;

export const RULES_LINE = "$1 to reveal. Keep for $2.99 more. Pass, or let the timer end, and the only option left is a $4.99 pack you see after you pay.";

/** The odds shown before anyone pays the $1. Peeked and blind packs share them. */
export function oddsLines(chaseOn: boolean): string[] {
  return [
    "8 of 12 cards are bulk, usually under $0.25",
    "3 are modest, usually $0.25 to $0.75",
    "1 is the best card in the pack, usually $0.75 to $2",
    "Pack value is usually under the keep price",
    // Flag off: $10+ cards never go in packs, and the odds say so. Flag on: the 1 in 25 line replaces it.
    chaseOn ? "About 1 in 25 packs contains a card priced at $10 or more." : "Chase cards are not in packs until that feature is turned on",
  ];
}

export function slotOf(price: number | null | undefined): Slot | "chase" | null {
  if (price == null || !(price >= 0)) return null;
  if (price >= BIN.chaseFrom) return "chase";
  if (price < BIN.midFrom) return "bulk";
  if (price < BIN.topFrom) return "mid";
  if (price <= BIN.topTo) return "top";
  return null; // $2.01–$9.99: stays in inventory, never packed
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const sumValue = (prices: number[]) => round2(prices.reduce((a, b) => a + b, 0));

export interface PoolCard {
  id: string;
  price: number;
}

export type Rng = (n: number) => number; // integer in [0, n)
/** Unbiased crypto-random integer in [0, n). Works in Node and the browser (no node: import, so the UI can share this file). */
export const cryptoRng: Rng = (n) => {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
};

function pick<T>(xs: T[], k: number, rng: Rng): T[] {
  const a = [...xs];
  for (let i = 0; i < k; i++) {
    const j = i + rng(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

export interface Shortage {
  slot: Slot;
  have: number;
  need: number;
}

/** What the bins can't cover for one pack. Empty = every slot can be filled. */
export function shortages(pool: PoolCard[]): Shortage[] {
  const have = { bulk: 0, mid: 0, top: 0 };
  for (const c of pool) {
    const s = slotOf(c.price);
    if (s === "bulk" || s === "mid" || s === "top") have[s]++;
  }
  return (Object.keys(SLOTS) as Slot[]).filter((s) => have[s] < SLOTS[s]).map((s) => ({ slot: s, have: have[s], need: SLOTS[s] }));
}

/**
 * Draw one normal pack: 8 bulk, 3 mid, 1 top, at random. If the total misses $1.80–$2.40, throw it out and draw again.
 * Returns null when a slot can't be filled or no draw lands in the band (never pads with the wrong value).
 */
export function drawPack(pool: PoolCard[], rng: Rng = cryptoRng, attempts = 400): { ids: string[]; value: number } | null {
  const bins: Record<Slot, PoolCard[]> = { bulk: [], mid: [], top: [] };
  for (const c of pool) {
    const s = slotOf(c.price);
    if (s === "bulk" || s === "mid" || s === "top") bins[s].push(c);
  }
  if ((Object.keys(SLOTS) as Slot[]).some((s) => bins[s].length < SLOTS[s])) return null;
  for (let i = 0; i < attempts; i++) {
    const cards = [...pick(bins.bulk, SLOTS.bulk, rng), ...pick(bins.mid, SLOTS.mid, rng), ...pick(bins.top, SLOTS.top, rng)];
    const value = sumValue(cards.map((c) => c.price));
    if (value >= TARGET.min && value <= TARGET.max) return { ids: cards.map((c) => c.id), value };
  }
  return null;
}

/** Draw as many packs as the pool allows (up to `max`), each card used once. */
export function drawPacks(pool: PoolCard[], max: number, rng: Rng = cryptoRng) {
  const left = new Map(pool.map((c) => [c.id, c]));
  const packs: { ids: string[]; value: number }[] = [];
  while (packs.length < max) {
    const p = drawPack([...left.values()], rng);
    if (!p) break;
    p.ids.forEach((id) => left.delete(id));
    packs.push(p);
  }
  return packs;
}

/** Is this a pack the game may show? Normal packs stay in the band; only a chase pack may pass the $3.50 cap. */
export function showable(p: { value: number; chase: boolean }) {
  return p.chase || (p.value >= TARGET.min - 0.001 && p.value <= TARGET.max + 0.001 && p.value <= HARD_CAP);
}

/** 1 in 25, the same roll for peeked and blind packs. */
export const rollChase = (rng: Rng = cryptoRng) => rng(CHASE_RATE) === 0;

/**
 * The next local midnight in `tz` after `now`, as a UTC Date. Falls back to New York for an unknown zone.
 */
export function nextLocalMidnight(now: Date, tz: string): Date {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "America/New_York";
  }
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second };
  };
  const offsetMs = (d: Date) => {
    const p = parts(d);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
  };
  const today = parts(now);
  const wall = Date.UTC(today.y, today.m - 1, today.d + 1, 0, 0, 0); // tomorrow 00:00 on the local wall clock
  let t = wall - offsetMs(new Date(wall));
  t = wall - offsetMs(new Date(t)); // second pass settles DST changes
  return new Date(t);
}

export function isValidZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
