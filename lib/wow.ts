import type { Card } from "@prisma/client";
import { db } from "./db";
import type { Settings } from "./settings";
import { norm } from "./util";

/**
 * Wow score: how eye-catching a live item is, for the home hero and the "On the hunt" row.
 * Never uses price. Computed when a card is identified or repriced.
 */
export const WOW = { art: 40, chase: 25, graded: 20, newest: 10 } as const;
export type WowTag = keyof typeof WOW;

type WowCard = Pick<Card, "name" | "player" | "rarity" | "variant" | "graded" | "year" | "title">;

/** Full art, illustration rare (incl. special), alt art, or a numbered parallel (/25, #/99, "numbered"). */
const ART = /full[\s-]?art|illustration\s+rare|\balt(ernate)?[\s-]?art\b|numbered|serial|(^|[\s#])\/\s*\d{1,4}\b|\b\d{1,4}\s*\/\s*\d{1,4}\b/i;

export function isArtRare(c: WowCard) {
  // The number field ("4/102") is a collector number, so only rarity/variant/title count here.
  return ART.test([c.rarity, c.variant].filter(Boolean).join(" ")) || /full[\s-]?art|illustration\s+rare|\balt[\s-]?art\b/i.test(c.title ?? "");
}

export function isChase(c: WowCard, chase: string[]) {
  const who = norm(`${c.name ?? ""} ${c.player ?? ""}`);
  return chase.some((n) => n.trim() && who.includes(norm(n)));
}

/** "PSA 10", "BGS 9.5", "CGC 9" → true. */
export function isGraded9Plus(graded: string | null | undefined) {
  const n = Number(graded?.match(/(\d+(?:\.\d+)?)\s*$/)?.[1] ?? graded?.match(/\b(\d+(?:\.\d+)?)\b/)?.[1]);
  return Number.isFinite(n) && n >= 9 && n <= 10;
}

export function wowScore(c: WowCard, ctx: { chase: string[]; newestYear?: string | null }): { score: number; tags: WowTag[] } {
  const tags: WowTag[] = [];
  if (isArtRare(c)) tags.push("art");
  if (isChase(c, ctx.chase)) tags.push("chase");
  if (isGraded9Plus(c.graded)) tags.push("graded");
  if (ctx.newestYear && c.year && c.year === ctx.newestYear) tags.push("newest");
  return { score: tags.reduce((n, t) => n + WOW[t], 0), tags };
}

/** Newest set in the batch, by release year (what the catalogs give us). */
export async function newestYear(batchId: string) {
  const r = await db.card.findFirst({ where: { batchId, year: { not: null }, status: { notIn: ["Archived"] } }, orderBy: { year: "desc" }, select: { year: true } });
  return r?.year ?? null;
}

export function wowData(c: WowCard, s: Settings, newest: string | null) {
  const w = wowScore(c, { chase: s.chaseNames ?? [], newestYear: newest });
  return { wowScore: w.score, wowTags: w.tags.join(",") };
}

/** Recompute a whole batch (the newest set can change as more cards are identified). */
export async function recomputeBatchWow(batchId: string, s: Settings) {
  const newest = await newestYear(batchId);
  const cards = await db.card.findMany({ where: { batchId }, select: { id: true, name: true, player: true, rarity: true, variant: true, graded: true, year: true, title: true, wowScore: true, wowTags: true } });
  const changes = cards
    .map((c) => ({ c, w: wowData(c, s, newest) }))
    .filter(({ c, w }) => c.wowScore !== w.wowScore || c.wowTags !== w.wowTags);
  if (changes.length) await db.$transaction(changes.map(({ c, w }) => db.card.update({ where: { id: c.id }, data: w })));
  return changes.length;
}

/** One short line for the hero. No prices. */
export function hypeLine(c: { name: string | null; player?: string | null; setName: string | null; graded?: string | null; rarity?: string | null; variant?: string | null; wowTags: string }) {
  const tags = c.wowTags.split(",").filter(Boolean) as WowTag[];
  const who = c.player || c.name || "This one";
  if (tags.includes("art")) return `${c.rarity || c.variant || "Full art"}. The one you frame.`;
  if (tags.includes("chase")) return `${who}. Everybody's hunting this one.`;
  if (tags.includes("graded")) return `${c.graded}. Slabbed, sharp, ready for the shelf.`;
  if (tags.includes("newest")) return c.setName ? `Fresh out of ${c.setName}.` : "Fresh out of the newest set.";
  return "Pulled from my case. One of one.";
}
