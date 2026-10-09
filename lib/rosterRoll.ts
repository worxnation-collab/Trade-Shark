import { Prisma } from "@prisma/client";
import { caseWhere } from "./caseStock";
import { db } from "./db";
import { BIN } from "./game/rules";

/**
 * Roster Roll daily winner. Roster Roll writes one row per America/New_York date (POST /api/roster-roll/claim, the
 * only writer); the winner's link /case?reward=roster-roll&date=…&handle=… offers one free single from the same loose
 * stock the packs draw from. One pull per date: the row flips unclaimed → claimed as the card is taken. A bad link,
 * a claimed row or no row leaves The case as it is.
 */

/** A real YYYY-MM-DD calendar date, or null. */
export function parseDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** 3–16 characters, no spaces. */
export function parseHandle(v: unknown): string | null {
  return typeof v === "string" && /^\S{3,16}$/u.test(v) ? v : null;
}

export function parseScore(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Today's date in New York, YYYY-MM-DD. */
export function nyToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Cards the single can come from: loose stock (The case's own rule, so never energy, unpriced, packed or waiting on a
 * look), founder-owned only (a giveaway never owes a consignment sender), and below the chase line.
 */
const SINGLE_WHERE: Prisma.CardWhereInput = { AND: [caseWhere, { partnerId: { not: null } }, { listPrice: { lt: BIN.chaseFrom } }] };

const matchRow = (date: string, handle: string) => ({ date, handle: { equals: handle, mode: "insensitive" as const } });

/** True when this link should offer the pull: a matching unclaimed row and at least one card to give. */
export async function canPull(date: unknown, handle: unknown): Promise<boolean> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  if (!d || !h) return false;
  const row = await db.rosterRollClaim.findFirst({ where: { ...matchRow(d, h), status: "unclaimed" }, select: { date: true } });
  return !!row && (await db.card.count({ where: SINGLE_WHERE })) > 0;
}

export interface SingleView {
  id: string;
  name: string;
  setName: string | null;
  number: string | null;
  variant: string | null;
}

class NoStock extends Error {}

/**
 * Pull the single: flip the row to claimed and take one random card in one transaction. The card leaves stock as
 * Sold at $0 (soldChannel roster-roll). Returns null when the link doesn't match an unclaimed row (a second pull) or
 * there is nothing to give; nothing changes then.
 */
export async function pullSingle(date: unknown, handle: unknown, now = new Date()): Promise<SingleView | null> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  if (!d || !h) return null;
  try {
    return await db.$transaction(async (tx) => {
      const flip = await tx.rosterRollClaim.updateMany({ where: { ...matchRow(d, h), status: "unclaimed" }, data: { status: "claimed", claimedAt: now } });
      if (!flip.count) return null;
      for (let tries = 0; tries < 5; tries++) {
        const n = await tx.card.count({ where: SINGLE_WHERE });
        if (!n) break;
        const pick = await tx.card.findFirst({ where: SINGLE_WHERE, orderBy: { id: "asc" }, skip: Math.floor(Math.random() * n), select: { id: true } });
        if (!pick) continue;
        // Re-check the stock rule on the write, so a pack that took the card a moment ago wins and we draw again.
        const took = await tx.card.updateMany({ where: { AND: [{ id: pick.id }, SINGLE_WHERE] }, data: { status: "Sold", soldChannel: "roster-roll", soldPrice: 0, soldAt: now } });
        if (!took.count) continue;
        await tx.rosterRollClaim.update({ where: { date: d }, data: { cardId: pick.id } });
        return singleView(await tx.card.findUniqueOrThrow({ where: { id: pick.id }, select: VIEW_SELECT }));
      }
      throw new NoStock();
    });
  } catch (e) {
    if (e instanceof NoStock) return null;
    throw e;
  }
}

const VIEW_SELECT = { id: true, game: true, name: true, player: true, setName: true, year: true, number: true, variant: true } as const;
function singleView(c: Prisma.CardGetPayload<{ select: typeof VIEW_SELECT }>): SingleView {
  return {
    id: c.id,
    name: (c.game === "Sports" ? c.player || c.name : c.name) || "Card",
    setName: [c.year, c.setName].filter(Boolean).join(" ") || null,
    number: c.number || null,
    variant: c.variant || null,
  };
}

/** The card a claimed row gave, for its image (only with the same date + handle). */
export async function claimedCardId(date: unknown, handle: unknown): Promise<string | null> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  if (!d || !h) return null;
  const row = await db.rosterRollClaim.findFirst({ where: { ...matchRow(d, h), status: "claimed" }, select: { cardId: true } });
  return row?.cardId ?? null;
}

export type RecordResult = { ok: true } | { ok: false; status: number; error: string };

/** Roster Roll's write: one winner per New York date. A second write for that date is refused. */
export async function recordWinner(body: { date?: unknown; handle?: unknown; score?: unknown }, now = new Date()): Promise<RecordResult> {
  const date = parseDate(body.date);
  const handle = parseHandle(body.handle);
  const score = parseScore(body.score);
  if (!date) return { ok: false, status: 400, error: "date must be YYYY-MM-DD (America/New_York)" };
  if (date > nyToday(now)) return { ok: false, status: 400, error: "date is in the future (America/New_York)" };
  if (!handle) return { ok: false, status: 400, error: "handle must be 3–16 characters, no spaces" };
  if (score == null) return { ok: false, status: 400, error: "score must be a whole number ≥ 0" };
  try {
    await db.rosterRollClaim.create({ data: { date, handle, score } });
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, status: 409, error: "a winner is already recorded for that date" };
    throw e;
  }
}
