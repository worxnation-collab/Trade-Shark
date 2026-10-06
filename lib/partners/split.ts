/**
 * Partner payouts, the pure part. Three partners own the cards; the shop sells them in packs.
 * A sold pack (keep or blind only) pays out: pack price minus the Stripe fee, split by each partner's share of the
 * stack's engine value. The $1 on a peek that isn't kept, and every shipping charge, are never split.
 */

export const PARTNERS = [
  { id: "matthew", name: "Matthew" },
  { id: "adrian", name: "Adrian" },
  { id: "mike", name: "Mike" },
] as const;
export type PartnerId = (typeof PARTNERS)[number]["id"];
export const isPartner = (v: unknown): v is PartnerId => typeof v === "string" && PARTNERS.some((p) => p.id === v);
export const partnerName = (id: string | null | undefined) => PARTNERS.find((p) => p.id === id)?.name ?? "No partner";

/**
 * A keep is a $3.99 pack: the $1 reveal and the $2.99 keep together, so both charges and both fees count.
 * Set this false to split only the $2.99 keep charge (the $1 then stays with the shop on every peek).
 */
export const KEEP_SPLIT_INCLUDES_REVEAL = true;

/** Stripe's standard US card fee, used only when Stripe doesn't report the real one. */
export const estimateFee = (amount: number) => Math.round((amount * 0.029 + 0.3) * 100) / 100;

export interface Holding {
  partnerId: string | null; // null = a card with no partner (only in stacks built before partners): the shop keeps that share
  value: number;
}

/**
 * Split `net` by engine value. A partner's share = their cards' summed value ÷ the pack's summed value.
 * Each share is rounded to cents; any leftover cent (up or down) goes to the partner with the largest share.
 * Returns partner amounts in dollars; the shop's share of untagged cards is left out.
 */
export function splitNet(net: number, holdings: Holding[]) {
  const by = new Map<string, number>();
  for (const h of holdings) {
    const k = h.partnerId ?? "";
    by.set(k, (by.get(k) ?? 0) + Math.max(0, h.value));
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const cents = Math.round(Math.max(0, net) * 100);
  if (total <= 0 || cents <= 0) return [] as { partnerId: string; value: number; amount: number }[];
  const rows = [...by.entries()].map(([k, v]) => ({ k, value: Math.round(v * 100) / 100, raw: v, cents: Math.round((cents * v) / total) }));
  const left = cents - rows.reduce((a, r) => a + r.cents, 0);
  if (left) {
    const partners = rows.filter((r) => r.k);
    const biggest = (partners.length ? partners : rows).reduce((a, r) => (r.raw > a.raw ? r : a));
    biggest.cents += left;
  }
  return rows.filter((r) => r.k).map((r) => ({ partnerId: r.k, value: r.value, amount: r.cents / 100 }));
}
