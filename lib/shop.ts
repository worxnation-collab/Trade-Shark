import { shopEmail } from "./env";
import type { Settings } from "./settings";
import { shipForCard, shipFromLink, type ShipQuote } from "./shipping";

export function cardLabel(c: { name: string | null; player?: string | null; setName: string | null; number: string | null; year: string | null }) {
  return [c.year, c.setName, c.player || c.name, c.number && `#${c.number}`].filter(Boolean).join(" ");
}

export function mailtoFor(c: { id: string; name: string | null; setName: string | null; number: string | null; year: string | null }) {
  const to = shopEmail();
  const subject = `Trade Shark: ${cardLabel(c)}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Hi, I'm interested in this card (ref ${c.id}).`)}`;
}

/**
 * The only card fields public pages may read. Cost, margin, comps, notes and Stripe ids stay private.
 */
export const PUBLIC_CARD_SELECT = {
  id: true,
  status: true,
  game: true,
  name: true,
  player: true,
  setName: true,
  number: true,
  year: true,
  variant: true,
  condition: true,
  graded: true,
  quantity: true,
  listPrice: true,
  backImage: true,
  readable: true,
  listedChannel: true,
  listedUrl: true,
  paymentLinkUrl: true,
  paymentLinkActive: true,
  title: true,
  description: true,
  rarity: true,
  shippingProfile: true,
  paymentLinkShipping: true,
  paymentLinkShipMethod: true,
  wowScore: true,
  wowTags: true,
  updatedAt: true,
} as const;

/** Shipping the buyer sees: what the live link charges, else what the rules would charge. */
export function cardShipQuote(
  c: { listPrice: number | null; graded: string | null; shippingProfile: string; paymentLinkActive: boolean; paymentLinkShipping: number | null; paymentLinkShipMethod: string | null },
  s: Pick<Settings, "buyerShipping">,
): ShipQuote {
  return (c.paymentLinkActive && shipFromLink(c.paymentLinkShipMethod, c.paymentLinkShipping)) || shipForCard({ price: c.listPrice ?? 0, graded: c.graded, profile: c.shippingProfile }, s.buyerShipping);
}
