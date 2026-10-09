/**
 * Owner payouts, the pure part. Every card has an owner: a founder (Matthew, Adrian, Mike) or an outside sender
 * (consignment). A sold pack (keep or blind only): pack price − Stripe fee − any stamp credit = net, split among
 * founders by engine value. A consignment card takes no share: its sender is owed the card's engine price, paid
 * from the reserve. Memberships and shipping are company money and never split. Looking at a pack is free.
 */

export const PARTNERS = [
  { id: "matthew", name: "Matthew" },
  { id: "adrian", name: "Adrian" },
  { id: "mike", name: "Mike" },
] as const;
export type PartnerId = (typeof PARTNERS)[number]["id"];
export const isPartner = (v: unknown): v is PartnerId => typeof v === "string" && PARTNERS.some((p) => p.id === v);
export const partnerName = (id: string | null | undefined) => PARTNERS.find((p) => p.id === id)?.name ?? "No partner";

/** A stamp-card credit takes this off the pack price before the split. */
export const STAMP_CREDIT = 4;

/** An owner tag as one string: "f:<founder>" or "s:<sender id>". */
export type OwnerTag = { partnerId: string; senderId: null } | { partnerId: null; senderId: string };
export function parseOwner(v: unknown): OwnerTag | null {
  if (typeof v !== "string") return null;
  if (v.startsWith("f:") && isPartner(v.slice(2))) return { partnerId: v.slice(2), senderId: null };
  if (v.startsWith("s:") && /^[a-z0-9]{8,40}$/i.test(v.slice(2))) return { partnerId: null, senderId: v.slice(2) };
  return null;
}
export const ownerValue = (c: { partnerId?: string | null; senderId?: string | null }) => (c.partnerId ? `f:${c.partnerId}` : c.senderId ? `s:${c.senderId}` : "");

/**
 * The reserve. `balance` = company money put in minus sender payouts sent. `payable` = sold consignment cards not
 * paid yet. `committed` = consignment cards already sitting in built stacks. `liability` = every unsold consignment
 * card's engine price. Headroom = what one more stack's consignment cards may add up to.
 */
export function reserveState(r: { balance: number; payable: number; committed: number; liability: number }) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const onHand = r2(r.balance - r.payable);
  const headroom = r2(Math.max(0, onHand - r.committed));
  return { ...r, onHand, headroom, shortfall: r2(Math.max(0, r.liability - onHand)) };
}

/** Can a stack with these consignment card prices be built inside the headroom? */
export const fitsReserve = (consignedPrices: number[], headroom: number) => consignedPrices.reduce((a, b) => a + b, 0) <= headroom + 1e-9;

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
