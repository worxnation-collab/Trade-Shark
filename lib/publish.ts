import type { Card } from "@prisma/client";
import { db } from "./db";
import type { Settings } from "./settings";

/**
 * After upload. Cards never sell as singles: a good card goes to stock, and the packer puts stock
 * into 12-card category packs (lib/lilStack.ts), which carry the pay links.
 * - No name (identification failed) or no usable photo → hold in Inbox. Never invent a name.
 * - $5 and under → stock right away ("stock").
 * - Over $5, sideways, or the same scan twice → Needs a look until I approve it (then stock).
 * Uncertain prices still go; the $5 line is about dollars, not confidence.
 */
export const AUTO_PUBLISH_MAX = 5;

export type Decision = "hold" | "stock" | "review";

/** Statuses the upload run may still decide for. Anything I touched by hand is left alone. */
const UNDECIDED = ["Inbox", "Identified", "Priced", "BulkHold"];

/** A real name from a read or a catalog match. A guess from the file name doesn't count. */
export function isIdentified(c: Pick<Card, "name" | "player" | "identSource">) {
  return !!(c.name?.trim() || c.player?.trim()) && c.identSource !== "filename";
}

export function decide(
  c: Pick<Card, "name" | "player" | "identSource" | "readable" | "frontImage" | "listPrice"> & Partial<Pick<Card, "holdReason">>,
  sameScanTwice = false,
): Decision {
  if (c.holdReason?.startsWith("PDF") && c.readable && c.frontImage) return "review"; // flagged PDF page: a person checks it
  if (!c.readable || !c.frontImage || !isIdentified(c) || c.listPrice == null) return "hold";
  if (sameScanTwice) return "review"; // the exact same file uploaded again: don't sell one card twice
  if (c.holdReason === "rotation") return "review"; // never sell a card sideways
  if (c.holdReason?.startsWith("PDF")) return "review"; // a PDF page the splitter wasn't sure about
  return c.listPrice <= AUTO_PUBLISH_MAX ? "stock" : "review";
}

/**
 * The exact same image file was uploaded before (same front hash on an earlier card that isn't archived).
 * The first upload of a scan publishes; later copies wait for me instead of selling one card twice.
 */
async function isSameScanTwice(c: Card) {
  if (!c.frontHash) return false;
  const earlier = await db.card.findFirst({
    where: { id: { not: c.id }, frontHash: c.frontHash, status: { not: "Archived" }, createdAt: { lt: c.createdAt } },
    select: { id: true },
  });
  return !!earlier;
}

/** Decide one card and act on it. Returns the decision for the batch summary. */
export async function autoPublish(card: Card, _s?: Settings): Promise<Decision | "kept"> {
  if (!UNDECIDED.includes(card.status)) return "kept";
  const same = await isSameScanTwice(card);
  const d = decide(card, same);
  if (d === "hold") {
    await db.card.update({ where: { id: card.id }, data: { status: "Inbox" } });
  } else if (d === "review") {
    const why = card.holdReason ?? (same ? "same scan uploaded twice" : null);
    await db.card.update({ where: { id: card.id }, data: { status: "NeedsLook", holdReason: why } });
  } else {
    // Stock: the packer takes it from here. No single-card pay link.
    await db.card.update({ where: { id: card.id }, data: { status: "Priced", confirmedAt: card.confirmedAt ?? new Date() } });
  }
  return d;
}
