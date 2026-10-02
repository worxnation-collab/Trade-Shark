import type { Prisma } from "@prisma/client";
import { getSettings } from "./settings";

/**
 * One filter definition shared by the batch page, inventory, and the review screen,
 * so J/K walks exactly the list you were looking at.
 */
export interface QueueParams {
  batch?: string;
  pile?: string; // none | unpaired | unreadable | likely_bulk | duplicate | review | all
  status?: string;
  filter?: string; // noprice | conflict
  q?: string;
}

export async function queueWhere(p: QueueParams): Promise<Prisma.CardWhereInput> {
  const s = await getSettings();
  const and: Prisma.CardWhereInput[] = [];
  if (p.batch) and.push({ batchId: p.batch });
  if (p.status) and.push({ status: p.status });
  else if (!p.batch) and.push({ status: { not: "Archived" } });
  if (p.pile === "review") and.push({ confirmedAt: null, OR: [{ sourceConfidence: { lt: s.confidenceThreshold } }, { identConflict: true }, { priceConflict: true }, { pile: { not: "none" } }] });
  else if (p.pile && p.pile !== "all") and.push({ pile: p.pile });
  if (p.filter === "noprice") and.push({ listPrice: null, readable: true, status: { notIn: ["Sold", "Archived"] } });
  if (p.filter === "conflict") and.push({ OR: [{ priceConflict: true }, { identConflict: true }] });
  if (p.q) and.push({ OR: [{ name: { contains: p.q, mode: "insensitive" } }, { player: { contains: p.q, mode: "insensitive" } }, { setName: { contains: p.q, mode: "insensitive" } }, { frontOrigName: { contains: p.q, mode: "insensitive" } }, { pairId: { contains: p.q, mode: "insensitive" } }] });
  return { AND: and };
}

export function queueQuery(p: QueueParams) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const QUEUE_ORDER: Prisma.CardOrderByWithRelationInput[] = [{ batchId: "asc" }, { pairId: "asc" }];
