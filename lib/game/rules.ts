/**
 * The reveal game's rules, in one place. Pure: no database, no Stripe. The UI and the server read the same numbers.
 * Card values are the existing engine price (Card.listPrice); nothing here prices a card.
 */

export const PACK_CARDS = 12;
export const SLOTS = { bulk: 7, mid: 4, top: 1 } as const;
export type Slot = keyof typeof SLOTS;

/**
 * Value bins, in dollars. Bulk < 0.25 ≤ mid < 1.00 ≤ top < 4.00 ≤ hit < 10 ≤ chase.
 * The top slot is usually a $1–$2 card; the band below decides what fits. A member stack swaps its top slot for a
 * $2.01–$3.99 card (`BUMP`). Nothing $4 or more ever goes in a base pack.
 */
export const BIN = { midFrom: 0.25, topFrom: 1, hitFrom: 4, chaseFrom: 10 } as const;
/** The member stack's top-slot swap. */
export const BUMP = { from: 2.01, to: 3.99 } as const;
/** A base pack's summed value must land here (close to the $3.99 first-look keep); otherwise the draw is thrown out and drawn again. */
export const TARGET = { min: 3.2, max: 3.8 } as const;
/** A hit pack: one $4–$9.99 card plus 7 bulk and 4 mid. */
export const HIT_TARGET = { min: 5, max: 12 } as const;
/** Never show or sell a base pack above this. Hit, chase and member packs have their own rules. */
export const HARD_CAP = TARGET.max;

/** The mix over the last 100 built packs in a category. */
export const MIX = { window: 100, hit: 18, chase: 2 } as const;
/** Stop placing $4+ cards past these shares (of the last 100 built, and of the ready queue). */
export const HIT_CAP = { recent: 0.2, ready: 0.2 } as const;

export type PackKind = "base" | "hit" | "chase" | "member";

/**
 * Looking is free. The keep price climbs with each look of the day in a category: look 1 $3.99, look 2 $4.99,
 * look 3 $5.99; a new local day starts over. The price is stored on the cycle when the pack is shown and that is
 * the only amount a Keep charges. The blind pack ("Dealer's choice") is an optional quiet link, above the last look.
 */
export const KEEP_LADDER = [3.99, 4.99, 5.99] as const;
export const BLIND_PRICE = 6.99;
export const PRICES = { blind: BLIND_PRICE } as const;
/** How long a looked-at pack is held for the player. */
export const TIMER_SECONDS = 120;
/** Network slack on top of the 120 s before the server refuses a Keep. */
export const KEEP_GRACE_MS = 3000;
/** Free looks per category per local day (account and card), so nobody can fish the pool. */
export const LOOKS_PER_DAY = 3;
/** The same cap per network address, for visitors who clear their cookies. Higher: households share an address. */
export const LOOKS_PER_DAY_PER_IP = 12;
/** A Keep that goes to Stripe Checkout (no saved card yet) holds the pack this long (Stripe's shortest session). */
export const CHECKOUT_HOLD_MS = 30 * 60_000;

/** At most this many chase packs reserved at once per category, so one player can't drain the list. */
export const CHASE_RESERVE_CAP = 1;

export const RULES_LINE = "You roll it. You keep it or put it back. Three free rolls a day: the first is $3.99 to keep, the next is $4.99, the last is $5.99.";

/** The keep price for the nth look of the day (1-based) in a category. Past the ladder stays on its last step. */
export function keepPriceFor(look: number): number {
  const i = Math.min(KEEP_LADDER.length, Math.max(1, Math.floor(look) || 1)) - 1;
  return KEEP_LADDER[i];
}

/** Which look of the day the next one is, from how many this account and card already took today. */
export const nextLookNumber = (usedToday: number) => Math.min(KEEP_LADDER.length, Math.max(0, usedToday) + 1);

/**
 * What a Keep charges: the price stored on the cycle when the pack was shown, and nothing else. A client that sends
 * an amount must send that same amount (it is only checked, never used). A cycle from before the ladder = look 1.
 */
export const storedKeepPrice = (stored: number | null | undefined) => stored ?? KEEP_LADDER[0];

export function keepCharge(stored: number | null | undefined, asked?: unknown): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = storedKeepPrice(stored);
  if (asked !== undefined && asked !== null && Math.round(Number(asked) * 100) !== Math.round(amount * 100))
    return { ok: false, error: `This pack is $${amount.toFixed(2)} to keep.` };
  return { ok: true, amount };
}

/** The odds shown before anyone looks. Looked-at and blind packs share them. Chase is mentioned only when it's on. */
export function oddsLines(chaseOn: boolean): string[] {
  return [
    "11 cards are under $1.",
    "1 is the best card in the pack.",
    "About 1 in 5 packs, that best card is $4 or more.",
    ...(chaseOn ? ["About 2 in 100 packs contain a card priced at $10 or more."] : []),
    "Raw, as scanned. Sleeved and top-loaded. Not for grading.",
  ];
}

export type Bin = Slot | "hit" | "chase";

export function slotOf(price: number | null | undefined): Bin | null {
  if (price == null || !(price >= 0)) return null;
  if (price >= BIN.chaseFrom) return "chase";
  if (price >= BIN.hitFrom) return "hit";
  if (price < BIN.midFrom) return "bulk";
  if (price < BIN.topFrom) return "mid";
  return "top"; // $1–$3.99
}

export const isBump = (price: number | null | undefined) => price != null && price >= BUMP.from && price <= BUMP.to;

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const sumValue = (prices: number[]) => round2(prices.reduce((a, b) => a + b, 0));

export interface PoolCard {
  id: string;
  price: number;
  /** Same printed card (catalog id, or name + set + number): two in one pack = duplicate. */
  ident?: string | null;
  /** Pokemon energy type (Grass, Fire…). */
  type?: string | null;
  /** Sports player. */
  player?: string | null;
}

/** At most this many of one Pokemon type, or of one player, in a pack. */
export const SAME_LIMIT = 2;

/** Why a drawn pack isn't legal, in one line, or null if it's fine. */
export function packProblem(cards: PoolCard[]): string | null {
  const count = (key: (c: PoolCard) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const c of cards) {
      const k = key(c)?.trim().toLowerCase();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const dupe = top(count((c) => c.ident));
  if (dupe && dupe[1] > 1) return "duplicate card";
  const type = top(count((c) => c.type));
  if (type && type[1] > SAME_LIMIT) return `more than ${SAME_LIMIT} ${type[0][0].toUpperCase()}${type[0].slice(1)} Pokémon`;
  const who = top(count((c) => c.player));
  if (who && who[1] > SAME_LIMIT) return `more than ${SAME_LIMIT} cards of ${who[0].replace(/\b\w/g, (x) => x.toUpperCase())}`;
  return null;
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
  const bins: Record<Bin, PoolCard[]> = { bulk: [], mid: [], top: [], hit: [], chase: [] };
  for (const c of pool) {
    const b = slotOf(c.price);
    if (b) bins[b].push(c);
  }
  return bins;
}

/**
 * Draw one pack of a kind, at random: 7 bulk + 4 mid + one "best" card (top for base, $4–$9.99 for hit,
 * $10+ for chase). If the total misses that kind's band, throw it out and draw again.
 * Returns null when a slot can't be filled or no draw lands in the band (never pads with the wrong value).
 */
export function drawPack(
  pool: PoolCard[],
  rng: Rng = cryptoRng,
  attempts = 400,
  kind: "base" | "hit" | "chase" = "base",
  /** Tally of why legal-looking draws were thrown out (duplicate, same type, same player). */
  why?: Map<string, number>,
): { ids: string[]; value: number; best: string } | null {
  const bins = binsOf(pool);
  const bestBin: Bin = kind === "base" ? "top" : kind;
  if (bins.bulk.length < SLOTS.bulk || bins.mid.length < SLOTS.mid || bins[bestBin].length < 1) return null;
  const band = kind === "base" ? TARGET : kind === "hit" ? HIT_TARGET : { min: 0, max: Infinity };
  for (let i = 0; i < attempts; i++) {
    const best = pick(bins[bestBin], 1, rng)[0];
    const cards = [...pick(bins.bulk, SLOTS.bulk, rng), ...pick(bins.mid, SLOTS.mid, rng), best];
    const value = sumValue(cards.map((c) => c.price));
    if (value < band.min || value > band.max) continue;
    const problem = packProblem(cards);
    if (problem) {
      const k = problem.replace(/ cards of .+$/, " cards of one player");
      why?.set(k, (why.get(k) ?? 0) + 1);
      continue;
    }
    return { ids: cards.map((c) => c.id), value, best: best.id };
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

/** Is this a pack the game may show? Base packs stay in the $3.20–$3.80 band; hit packs in $5–$12; chase and member stacks by their own build. */
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
