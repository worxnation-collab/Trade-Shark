import type { Card } from "@prisma/client";
import type { Category } from "./categories";
import { db } from "./db";
import { BUILD_BATCH, TRAY, previewBuild, shortLine } from "./game/packs";
import { BIN, slotOf } from "./game/rules";
import { demoCardCount } from "./purge";
import { getSettings } from "./settings";

/**
 * The founder pack desk: every card on the desk has a tray slot ("B-14": tray letter = value bin, number = slot),
 * per category. Only cards a founder marked as placed can go into a pack; a pack is pulled by its slot codes.
 */
export type Tray = (typeof TRAY)[keyof typeof TRAY];
const ON_DESK = ["Identified", "Priced", "BulkHold", "NeedsLook"];

export const nameOf = (c: Pick<Card, "game" | "name" | "player">) => (c.game === "Sports" ? c.player || c.name : c.name) || "Unnamed card";
export const thumbOf = (c: Pick<Card, "frontImage" | "rotation">) => (c.frontImage ? `/api/admin/images/${c.frontImage}?r=${c.rotation}` : null);

export const NO_PRICE = "no price yet: type one";

/** Why a card sits in the Hold (or Unpriced) tray, in a few words (null = it belongs in a value tray). */
export function holdWhy(c: Pick<Card, "status" | "holdReason" | "listPrice" | "partnerId" | "senderId">, chaseOn: boolean): string | null {
  if (c.holdReason === "rotation") return "sideways? tap to turn";
  if (c.status === "NeedsLook") return c.holdReason ? c.holdReason : (c.listPrice ?? 0) > 5 ? "over $5: approve it" : "needs a look";
  if (!c.partnerId && !c.senderId) return "no owner tag";
  if (c.listPrice == null) return NO_PRICE;
  if (c.senderId) return "consignment (locked or reserve short)";
  if ((c.listPrice ?? 0) >= BIN.chaseFrom && !chaseOn) return "chase card, chase is off";
  return null;
}

export function trayFor(c: Pick<Card, "status" | "holdReason" | "listPrice" | "partnerId" | "senderId">, chaseOn: boolean, consignOk = false): Tray {
  const why = holdWhy(c, chaseOn);
  if (why === NO_PRICE) return TRAY.unpriced; // named and owned, waiting only for a typed price
  if (why && !(consignOk && c.senderId && why.startsWith("consignment"))) return TRAY.hold;
  const b = slotOf(c.listPrice);
  return b === "bulk" ? TRAY.bulk : b === "mid" ? TRAY.mid : b === "top" ? TRAY.top : TRAY.hit; // hit and (chase on) chase
}

/** Give every desk card in a category a slot in the right tray. A card whose tray changed gets a new slot to move to. */
export async function assignLocations(category: Category) {
  const s = await getSettings();
  const chaseOn = !!s.chaseOn?.[category];
  const cards = await db.card.findMany({ where: { category, status: { in: ON_DESK }, gamePackId: null }, orderBy: { createdAt: "asc" } });
  const all = await db.card.findMany({ where: { category, location: { not: null } }, select: { location: true } });
  const next = new Map<string, number>();
  for (const { location } of all) {
    const [t, n] = (location ?? "").split("-");
    next.set(t, Math.max(next.get(t) ?? 0, Number(n) || 0));
  }
  let moved = 0;
  for (const c of cards) {
    const tray = trayFor(c, chaseOn, s.consignOpen);
    if (c.location?.startsWith(`${tray}-`)) continue;
    const n = (next.get(tray) ?? 0) + 1;
    next.set(tray, n);
    await db.card.update({ where: { id: c.id }, data: { location: `${tray}-${n}`, sortedAt: null } });
    moved++;
  }
  return moved;
}

const codeOrder = (a: string | null, b: string | null) => {
  const [ta, na] = (a ?? "Z-0").split("-");
  const [tb, nb] = (b ?? "Z-0").split("-");
  return ta.localeCompare(tb) || Number(na) - Number(nb);
};

/** Everything the desk shows for one category. */
export async function deskData(category: Category) {
  await assignLocations(category);
  const s = await getSettings();
  const chaseOn = !!s.chaseOn?.[category];
  const [demo, real, inbox, cards, pulling, onSale, plan] = await Promise.all([
    demoCardCount(),
    db.card.count({ where: { status: { not: "Archived" } } }),
    db.card.count({ where: { status: "Inbox" } }),
    db.card.findMany({ where: { category, status: { in: ON_DESK }, gamePackId: null } }),
    db.gamePack.findMany({ where: { category, status: "pulling" }, orderBy: { number: "asc" }, include: { cards: true } }),
    db.gamePack.count({ where: { category, status: "available" } }),
    previewBuild(category, BUILD_BATCH),
  ]);
  const row = (c: Card) => ({
    id: c.id,
    code: c.location ?? "—",
    name: nameOf(c),
    price: c.listPrice,
    thumb: thumbOf(c),
    sorted: !!c.sortedAt,
    why: holdWhy(c, chaseOn),
    rotation: c.holdReason === "rotation",
    chase: (c.listPrice ?? 0) >= BIN.chaseFrom,
  });
  const byTray = (t: Tray) => cards.filter((c) => c.location?.startsWith(`${t}-`)).sort((a, b) => codeOrder(a.location, b.location)).map(row);
  return {
    counts: { demo, real, inbox },
    columns: [
      { tray: TRAY.bulk, label: "Bulk", note: "under $0.25", cards: byTray(TRAY.bulk) },
      { tray: TRAY.mid, label: "Mid", note: "$0.25–$0.99", cards: byTray(TRAY.mid) },
      { tray: TRAY.top, label: "Top", note: "$1–$3.99", cards: byTray(TRAY.top) },
      { tray: TRAY.hit, label: "Hit", note: chaseOn ? "$4 and up" : "$4–$9.99", cards: byTray(TRAY.hit) },
      { tray: TRAY.unpriced, label: "Unpriced", note: "no source priced it: type a price", cards: byTray(TRAY.unpriced) },
      { tray: TRAY.hold, label: "Hold", note: "fix before packing", cards: byTray(TRAY.hold) },
    ],
    toPlace: cards.filter((c) => c.location && !c.sortedAt).sort((a, b) => codeOrder(a.location, b.location)).map(row),
    canBuild: plan.packs.length,
    short: shortLine(plan, BUILD_BATCH),
    pulling: pulling.map((p) => {
      const byId = new Map(p.cards.map((c) => [c.id, c]));
      return {
        id: p.id,
        number: p.number,
        kind: p.kind,
        value: p.value,
        cards: p.cardIds
          .map((id) => byId.get(id))
          .filter((c): c is Card => !!c)
          .sort((a, b) => codeOrder(a.location, b.location))
          .map((c) => ({ id: c.id, code: c.location ?? "—", name: nameOf(c), price: c.listPrice ?? 0, hit: c.id === p.hitCardId })),
      };
    }),
    onSale,
  };
}
export type DeskData = Awaited<ReturnType<typeof deskData>>;
