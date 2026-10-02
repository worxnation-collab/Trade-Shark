import { shopEmail } from "./env";

export function cardLabel(c: { name: string | null; player?: string | null; setName: string | null; number: string | null; year: string | null }) {
  return [c.year, c.setName, c.player || c.name, c.number && `#${c.number}`].filter(Boolean).join(" ");
}

export function mailtoFor(c: { id: string; name: string | null; setName: string | null; number: string | null; year: string | null }) {
  const to = shopEmail();
  const subject = `Trade Shark: ${cardLabel(c)}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Hi, I'm interested in this card (ref ${c.id}).`)}`;
}
