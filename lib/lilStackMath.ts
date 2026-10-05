/** Pure pack helpers, safe to import from client components. */
import { productName } from "./categories";

/** A pack is exactly this many cards from one category. */
export const PACK_SIZE = 12;

/** Pack value = the sum of the cards' existing prices. No rounding, no minimum, no other price source. */
export function packPrice(prices: (number | null | undefined)[]) {
  return Math.round(prices.reduce<number>((n, p) => n + (p ?? 0), 0) * 100) / 100;
}

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** "12 cards, $14.50." — the math under the Buy button. */
export const packMath = (count: number, price: number) => `${count} card${count === 1 ? "" : "s"}, ${usd(price)}.`;

/** "Pokemon Pack #3" */
export const packLabel = (category: string | null | undefined, n: number) => `${productName(category)} #${n}`;
