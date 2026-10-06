/**
 * The reveal game's rules, in one place. Pure: no database, no Stripe. The UI and the server read the same numbers.
 * Card values are the existing engine price (Card.listPrice); nothing here prices a card.
 */

export const PACK_CARDS = 12;
export const SLOTS = { bulk: 8, mid: 3, top: 1 } as const;
export type Slot = keyof typeof SLOTS;

/**
 * Value bins, in dollars. Bulk < 0.25 ≤ mid < 0.75 ≤ top ≤ 2.00 < bump < 4.00 ≤ hit < 10 ≤ chase.
 * Bump cards ($2.01–$3.99) only ever sit in the top slot of a member stack.
 */
export const BIN = { midFrom: 0.25, topFrom: 0.75, topTo: 2, hitFrom: 4, chaseFrom: 10 } as const;
/** A base pack's summed value must land here; otherwise the draw is thrown out and drawn again. */
export const TARGET = { min: 1.8, max: 2.4 } as const;
/** A hit pack: one $4–$9.99 card plus 8 bulk and 3 mid, summed $5–$11. */
export const HIT_TARGET = { min: 5, max: 11 } as const;
/** Never show or sell a base pack above this. Hit, chase and member packs have their own rules. */
export const HARD_CAP = 3.5;

/** The mix over the last 100 built packs in a category. */
export const MIX = { window: 100, hit: 18, chase: 2 } as const;
/** Stop placing $4+ cards past these shares (of the last 100 built, and of the ready queue). */
export const HIT_CAP = { recent: 0.2, ready: 0.2 } as const;

export type PackKind = "base" | "hit" | "chase" | "member";

export const PRICES = { reveal: 1, keepMore: 2.99, keepTotal: 3.99, blind: 4.99 } as const;
export const TIMER_SECONDS = 30;
/** When the pack graphic nudges and the Keep button pulses (seconds after the reveal). */
export const NUDGES = [10, 20] as const;
/** Network slack on top of the 30 s before the server refuses a Keep. */
export const KEEP_GRACE_MS = 3000;

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
    "About 18 in 100 packs contain a card priced from $4 to $10.",
    // Flag off: $10+ cards never go in packs, and the odds say so. Flag on: the $10 line replaces it.
    chaseOn ? "About 2 in 100 packs contain a card priced at $10 or more." : "Chase cards are not in packs until that feature is turned on",
  ];
}

export type Bin = Slot | "bump" | "hit" | "chase";

export function slotOf(price: number | null | undefined): Bin | null {
  if (price == null || !(price >= 0)) return null;
  if (price >= BIN.chaseFrom) return "chase";
  if (price >= BIN.hitFrom) return "hit";
  if (price < BIN.midFrom) return "bulk";
  if (price < BIN.topFrom) return "mid";
  if (price <= BIN.topTo) return "top";
  return "bump"; // $2.01–$3.99: only the top slot of a member stack
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

function binsOf(pool: PoolCard[]) {
  const bins: Record<Bin, PoolCard[]> = { bulk: [], mid: [], top: [], bump: [], hit: [], chase: [] };
  for (const c of pool) {
    const b = slotOf(c.price);
    if (b) bins[b].push(c);
  }
  return bins;
}

/**
 * Draw one pack of a kind, at random: 8 bulk + 3 mid + one "best" card (top for base, $4–$9.99 for hit,
 * $10+ for chase). If the total misses that kind's band, throw it out and draw again.
 * Returns null when a slot can't be filled or no draw lands in the band (never pads with the wrong value).
 */
export function drawPack(pool: PoolCard[], rng: Rng = cryptoRng, attempts = 400, kind: "base" | "hit" | "chase" = "base"): { ids: string[]; value: number; best: string } | null {
  const bins = binsOf(pool);
  const bestBin: Bin = kind === "base" ? "top" : kind;
  if (bins.bulk.length < SLOTS.bulk || bins.mid.length < SLOTS.mid || bins[bestBin].length < 1) return null;
  const band = kind === "base" ? TARGET : kind === "hit" ? HIT_TARGET : { min: 0, max: Infinity };
  for (let i = 0; i < attempts; i++) {
    const best = pick(bins[bestBin], 1, rng)[0];
    const cards = [...pick(bins.bulk, SLOTS.bulk, rng), ...pick(bins.mid, SLOTS.mid, rng), best];
    const value = sumValue(cards.map((c) => c.price));
    if (value >= band.min && value <= band.max) return { ids: cards.map((c) => c.id), value, best: best.id };
  }
  return null;
}

/** Draw as many base packs as the pool allows (up to `max`), each card used once. */
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

/**
 * Which kind the next built pack should be, so the last 100 built in a category come out about
 * 80 base / 18 hit / 2 chase. `recent` = kinds of the packs built before it, newest first.
 * A kept (or sold) hit still counts: every built pack stays in the window whatever happened to it.
 * No more hits while hits are over 20% of the last 100, or over a fifth of the ready queue.
 */
export function nextKind(o: {
  recent: PackKind[];
  ready: { total: number; hit: number };
  hitCards: boolean;
  chaseOn: boolean;
  chaseCards: boolean;
}): "base" | "hit" | "chase" {
  const window = o.recent.filter((k) => k !== "member").slice(0, MIX.window - 1);
  const n = window.length + 1;
  const hits = window.filter((k) => k === "hit").length;
  const chases = window.filter((k) => k === "chase").length;
  if (o.chaseOn && o.chaseCards && chases < Math.round((MIX.chase * n) / MIX.window)) return "chase";
  const hitShare = window.length ? hits / window.length : 0;
  const readyShare = o.ready.total ? o.ready.hit / o.ready.total : 0;
  const hitAllowed = o.hitCards && hitShare <= HIT_CAP.recent && readyShare <= HIT_CAP.ready;
  if (hitAllowed && hits < Math.round((MIX.hit * n) / MIX.window)) return "hit";
  return "base";
}

/** Is this a pack the game may show? Base packs stay in the band and under $3.50; hit packs in $5–$11; chase and member stacks by their own build. */
export function showable(p: { value: number; kind?: string; chase?: boolean }) {
  const kind = p.kind ?? (p.chase ? "chase" : "base");
  if (kind === "chase" || kind === "member") return true;
  if (kind === "hit") return p.value >= HIT_TARGET.min - 0.001 && p.value <= HIT_TARGET.max + 0.001;
  return p.value >= TARGET.min - 0.001 && p.value <= TARGET.max + 0.001 && p.value <= HARD_CAP;
}

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
