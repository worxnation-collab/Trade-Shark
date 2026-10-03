import type { Card } from "@prisma/client";
import { db } from "./db";
import { issuePaymentLink } from "./payLink";
import { LIL_STACK_UNDER } from "./pricing/engine";
import type { Settings } from "./settings";

/**
 * Auto-publish after upload. A fun shop, not a review desk:
 * - No name (identification failed) or no usable photo → hold in Inbox. Never invent a name.
 * - Under $1 → Lil' Stack (the packer bundles it and the pack gets the pay link).
 * - $1–$5 → For Sale right away, pay link (with shipping) created first.
 * - Over $5 → Needs a look: admin only until I approve or correct it.
 * Uncertain prices still publish; the $5 line is about dollars, not confidence.
 */
export const AUTO_PUBLISH_MAX = 5;

export type Decision = "hold" | "stack" | "publish" | "review";

/** Statuses the upload run may still decide for. Anything I touched by hand is left alone. */
const UNDECIDED = ["Inbox", "Identified", "Priced", "BulkHold"];

/** A real name from a read or a catalog match. A guess from the file name doesn't count. */
export function isIdentified(c: Pick<Card, "name" | "player" | "identSource">) {
  return !!(c.name?.trim() || c.player?.trim()) && c.identSource !== "filename";
}

export function decide(c: Pick<Card, "name" | "player" | "identSource" | "readable" | "frontImage" | "listPrice">, sameScanTwice = false): Decision {
  if (!c.readable || !c.frontImage || !isIdentified(c) || c.listPrice == null) return "hold";
  if (sameScanTwice) return "review"; // the exact same file uploaded again: don't sell one card twice
  if (c.listPrice < LIL_STACK_UNDER) return "stack";
  return c.listPrice <= AUTO_PUBLISH_MAX ? "publish" : "review";
}

async function isSameScanTwice(c: Card) {
  if (!c.duplicateOfId || !c.frontHash) return false;
  const other = await db.card.findUnique({ where: { id: c.duplicateOfId }, select: { frontHash: true } });
  return other?.frontHash === c.frontHash;
}

/** Decide one card and act on it. Returns the decision for the batch summary. */
export async function autoPublish(card: Card, s: Settings): Promise<Decision | "kept"> {
  if (!UNDECIDED.includes(card.status)) return "kept";
  const d = decide(card, await isSameScanTwice(card));
  if (d === "hold") {
    await db.card.update({ where: { id: card.id }, data: { status: "Inbox" } });
  } else if (d === "stack") {
    await db.card.update({ where: { id: card.id }, data: { status: "BulkHold" } }); // the packer takes it from here
  } else if (d === "review") {
    await db.card.update({ where: { id: card.id }, data: { status: "NeedsLook" } });
  } else {
    // The pay link (price + shipping line) exists before the card shows on the shop.
    const r = await issuePaymentLink(card, s);
    if (r.ok) await db.card.update({ where: { id: card.id }, data: { status: "Ready", confirmedAt: card.confirmedAt ?? new Date() } });
    else {
      await db.card.update({ where: { id: card.id }, data: { status: "NeedsLook" } });
      await db.sourceRun.create({ data: { cardId: card.id, source: "stripe", phase: "price", status: "error", reason: `Pay link failed, so it waits in Needs a look: ${r.error}`.slice(0, 500) } });
      return "review";
    }
  }
  return d;
}

/** Catch named cards a rebuild or reprice left undecided (e.g. pulled out of a Lil' Stack at $1+). */
export async function publishLeftovers(batchId: string, s: Settings, limit = 3) {
  const cards = await db.card.findMany({
    where: { batchId, status: { in: ["Identified", "Priced", "BulkHold"] }, listPrice: { gte: LIL_STACK_UNDER } },
    take: limit,
  });
  for (const c of cards) await autoPublish(c, s);
  return cards.length;
}
