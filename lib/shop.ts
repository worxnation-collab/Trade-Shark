import { shopEmail } from "./env";

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
  rarity: true,
  wowScore: true,
  wowTags: true,
  updatedAt: true,
} as const;
