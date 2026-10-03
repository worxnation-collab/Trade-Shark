import { artUrls } from "./brandArt";
import { db } from "./db";
import { getFeatured, type Featured } from "./featured";
import { publicPacks } from "./lilStack";
import { getSettings } from "./settings";
import { cardLabel, cardShipQuote, PUBLIC_CARD_SELECT } from "./shop";
import { FOR_SALE } from "./types";
import { hypeLine } from "./wow";

/**
 * Home: one hero (the most eye-catching live item) and "On the hunt" (the next 6).
 * Ranked by the pin, then wow score, then freshness. Never by price.
 */
interface Base {
  id: string;
  wow: number;
  fresh: number;
  price: number | null;
  buyUrl: string | null;
  href: string;
  hype: string;
  ship: { amount: number; label: string; free: boolean };
}
export interface CardItem extends Base {
  kind: "card";
  name: string;
  setLine: string | null;
  image: string;
}
export interface StackItem extends Base {
  kind: "stack";
  name: string;
  setLine: string;
  cards: { id: string; name: string }[];
  art: string | null;
}
export type HomeItem = CardItem | StackItem;

export const HUNT_SIZE = 6;

export function rankHome<T extends { kind: "card" | "stack"; id: string; wow: number; fresh: number }>(items: T[], featured: Featured): T[] {
  const pinned = (x: T) => (featured && x.kind === featured.kind && x.id === featured.id ? 1 : 0);
  return [...items].sort((a, b) => pinned(b) - pinned(a) || b.wow - a.wow || b.fresh - a.fresh);
}

export async function homeFeed(): Promise<{ hero: HomeItem | null; hunt: HomeItem[] }> {
  const [cards, packs, featured, art, s] = await Promise.all([
    db.card.findMany({
      where: { status: { in: FOR_SALE }, listPrice: { not: null }, frontImage: { not: null }, readable: true },
      select: PUBLIC_CARD_SELECT,
      take: 500,
    }),
    publicPacks(),
    getFeatured(),
    artUrls().catch(() => ({}) as Record<string, string>),
    getSettings(),
  ]);
  const items: HomeItem[] = [
    ...cards.map(
      (c): CardItem => ({
        kind: "card",
        id: c.id,
        wow: c.wowScore,
        fresh: c.updatedAt.getTime(),
        price: c.listPrice,
        buyUrl: c.paymentLinkActive && c.paymentLinkUrl ? c.paymentLinkUrl : null,
        href: `/card/${c.id}`,
        hype: hypeLine(c),
        ship: cardShipQuote(c, s),
        name: (c.game === "Sports" ? c.player || c.name : c.name) || cardLabel(c),
        setLine: [c.year, c.setName, c.number && `#${c.number}`].filter(Boolean).join(" ") || null,
        image: `/api/shop/image/${c.id}/front`,
      }),
    ),
    // Only packs you can actually buy compete for the hero.
    ...packs
      .filter((p) => p.buyUrl)
      .map(
        (p): StackItem => ({
          kind: "stack",
          id: p.id,
          wow: p.wow,
          fresh: 0,
          price: p.price,
          buyUrl: p.buyUrl,
          href: `/lil-stack?pack=${p.id}`,
          hype: `${p.cards.length} cards, one bite. See every card before you buy.`,
          ship: p.ship,
          name: p.label,
          setLine: `${p.cards.length} cards`,
          cards: p.cards.map((c) => ({ id: c.id, name: c.name })),
          art: "closed" in art ? (art.closed ?? null) : null,
        }),
      ),
  ];
  const ranked = rankHome(items, featured);
  return { hero: ranked[0] ?? null, hunt: ranked.slice(1, 1 + HUNT_SIZE) };
}
