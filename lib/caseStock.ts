import type { Prisma } from "@prisma/client";
import { PUBLIC_CATEGORIES } from "./categories";
import { db } from "./db";

/**
 * The case: loose stock a customer may look at (never buy one by one). Priced, readable, owned cards that are not in a
 * listed pack, never energy, never unpriced, never a card waiting on a look. A card drops out the moment a pack takes it.
 */
export const caseWhere: Prisma.CardWhereInput = {
  status: { in: ["Priced", "BulkHold"] },
  gamePackId: null,
  listPrice: { not: null },
  readable: true,
  frontImage: { not: null },
  category: { in: PUBLIC_CATEGORIES }, // public categories only: baseball and football stay on the desk
  OR: [{ partnerId: { not: null } }, { senderId: { not: null } }],
  NOT: { name: { contains: "energy", mode: "insensitive" } },
};

export interface CaseCard {
  id: string;
  name: string;
  set: string | null;
  price: number;
}

/** Up to `limit` cards for the reel, shuffled so every visit drifts a different mix. */
export async function caseCards(limit = 160): Promise<CaseCard[]> {
  const rows = await db.card.findMany({ where: caseWhere, select: { id: true, name: true, player: true, game: true, setName: true, year: true, listPrice: true }, take: 600 });
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    name: (r.game === "Sports" ? r.player || r.name : r.name) || "Card",
    set: [r.year, r.setName].filter(Boolean).join(" ") || null,
    price: r.listPrice!,
  }));
}
