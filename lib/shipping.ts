import type { Settings } from "./settings";

/**
 * What the buyer pays to ship, added on top of the merchandise price (never baked into it).
 * - Stamped envelope (PWE): a single raw card under $20, no tracking promise.
 * - Tracked bubble mailer: any graded card, any order of $20+, every Lil' Stack, or a card I set to bubble/slab.
 * - Free: a single card whose price is at or over the cutoff ($35). Never on a Lil' Stack.
 */
export type ShipMethod = "pwe" | "bubble";

export const SHIP_LABEL: Record<ShipMethod, string> = { pwe: "Stamped envelope", bubble: "Tracked bubble mailer" };
export const BUBBLE_AT = 20;

export interface ShipQuote {
  method: ShipMethod;
  label: string;
  amount: number; // 0 when free
  free: boolean;
  tracked: boolean;
}

type Rates = Settings["buyerShipping"];

function quote(method: ShipMethod, amount: number, free = false): ShipQuote {
  return { method, label: SHIP_LABEL[method], amount: free ? 0 : amount, free, tracked: method === "bubble" };
}

/** One card. `profile` is the card's shipping profile: bubble/slab is my override to a mailer. */
export function shipForCard(c: { price: number; graded?: string | null; profile?: string | null }, r: Rates): ShipQuote {
  const bubble = !!c.graded?.trim() || c.price >= BUBBLE_AT || c.profile === "bubble" || c.profile === "slab";
  if (c.price >= r.freeAt) return quote("bubble", r.bubble, true);
  return bubble ? quote("bubble", r.bubble) : quote("pwe", r.pwe);
}

/** A Lil' Stack always goes in a tracked bubble mailer, and never ships free. */
export function shipForStack(r: Rates): ShipQuote {
  return quote("bubble", r.bubble);
}

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** "Cards $4 · Shipping $6 · Total $10" — shown before every buy button. */
export function checkoutLine(merch: number, ship: { amount: number; free: boolean }, noun: "Card" | "Cards") {
  const total = Math.round((merch + ship.amount) * 100) / 100;
  return `${noun} ${usd(merch)} · Shipping ${ship.free ? "free" : usd(ship.amount)} · Total ${usd(total)}`;
}

export const shipFromLink = (method: string | null | undefined, amount: number | null | undefined): ShipQuote | null =>
  method === "pwe" || method === "bubble" ? quote(method, amount ?? 0, amount === 0) : null;
