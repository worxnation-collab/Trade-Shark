/** Pure Lil' Stack helpers, safe to import from client components. */
export const PACK_MIN_PRICE = 3;

/** Sum of list prices, rounded up to the nearest dollar, minimum $3. */
export function packPrice(prices: (number | null | undefined)[]) {
  const cents = Math.round(prices.reduce<number>((n, p) => n + (p ?? 0), 0) * 100);
  return Math.max(PACK_MIN_PRICE, Math.ceil(cents / 100));
}

/** "6 cards, $4." — the math under the Buy button. */
export const packMath = (count: number, price: number) => `${count} card${count === 1 ? "" : "s"}, $${price}.`;

/** Public name: the first pack is "Lil' Stack", then "Lil' Stack 2", "Lil' Stack 3", … */
export const packLabel = (n: number) => (n <= 1 ? "Lil' Stack" : `Lil' Stack ${n}`);
