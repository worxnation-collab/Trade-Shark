import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { caseWhere } from "./caseStock";
import { db } from "./db";
import { BIN } from "./game/rules";
import { vaultCard } from "./game/vault";
import type { SingleView } from "./rosterRollLink";

export type { SingleView } from "./rosterRollLink";

/**
 * Roster Roll daily winner. Roster Roll writes one row per America/New_York date (POST /api/roster-roll/claim, the
 * only writer); the winner's link /case?reward=roster-roll&date=…&handle=… offers one free single from the same loose
 * stock the packs draw from. The link also carries a secret `code` (sent with the winner by Roster Roll, stored only as
 * a hash): the date and handle are public on the board, so they alone never open the pull. One pull per date: the row flips unclaimed → claimed as the card is taken. A bad link,
 * a claimed row or no row leaves The case as it is. The prize never ships on its own: it goes into the winner's vault
 * (Collection), and they choose to ship it or sell it back from there.
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

/** The link's secret: 22–64 url-safe characters. */
export function parseCode(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(v) ? v : null;
}
const codeHash = (code: string) => createHash("sha256").update(`roster-roll-code:${code}`).digest("hex");

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

const matchRow = (date: string, handle: string, code?: string) => ({ date, handle: { equals: handle, mode: "insensitive" as const }, ...(code ? { codeHash: codeHash(code) } : {}) });

/** True when this link should offer the pull: a matching unclaimed row (code included) and at least one card to give. */
export async function canPull(date: unknown, handle: unknown, code: unknown): Promise<boolean> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  const c = parseCode(code);
  if (!d || !h || !c) return false;
  const row = await db.rosterRollClaim.findFirst({ where: { ...matchRow(d, h, c), status: "unclaimed" }, select: { date: true } });
  return !!row && (await db.card.count({ where: SINGLE_WHERE })) > 0;
}


class NoStock extends Error {}

/**
 * Pull the single: flip the row to claimed, reserve one random card and put it in the winner's vault, in one
 * transaction. The card is not sold and nothing ships: it sits as Vaulted under `buyerId` until they ship it or sell
 * it back. Returns null when the link doesn't match an unclaimed row (a second pull) or there is nothing to give;
 * nothing changes then.
 */
export async function pullSingle(date: unknown, handle: unknown, code: unknown, buyerId: string, now = new Date()): Promise<SingleView | null> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  const c = parseCode(code);
  if (!d || !h || !c) return null;
  try {
    return await db.$transaction(async (tx) => {
      const flip = await tx.rosterRollClaim.updateMany({ where: { ...matchRow(d, h, c), status: "unclaimed" }, data: { status: "claimed", claimedAt: now } });
      if (!flip.count) return null;
      for (let tries = 0; tries < 5; tries++) {
        const n = await tx.card.count({ where: SINGLE_WHERE });
        if (!n) break;
        const pick = await tx.card.findFirst({ where: SINGLE_WHERE, orderBy: { id: "asc" }, skip: Math.floor(Math.random() * n), select: { id: true } });
        if (!pick) continue;
        // vaultCard re-checks the stock rule on the write, so a pack that took the card a moment ago wins and we draw again.
        const item = await vaultCard(tx, { buyerId, cardId: pick.id, where: SINGLE_WHERE, source: "roster-roll", sourceRef: d, now });
        if (!item) continue;
        const row = await tx.rosterRollClaim.update({ where: { date: d }, data: { cardId: pick.id, buyerId } });
        return singleView(row, await tx.card.findUniqueOrThrow({ where: { id: pick.id }, select: VIEW_SELECT }));
      }
      throw new NoStock();
    });
  } catch (e) {
    if (e instanceof NoStock) return null;
    throw e;
  }
}

const VIEW_SELECT = { id: true, game: true, name: true, player: true, setName: true, year: true, number: true, variant: true } as const;
function singleView(row: { date: string; handle: string }, c: Prisma.CardGetPayload<{ select: typeof VIEW_SELECT }>): SingleView {
  return {
    id: c.id,
    date: row.date,
    handle: row.handle,
    name: (c.game === "Sports" ? c.player || c.name : c.name) || "Card",
    setName: [c.year, c.setName].filter(Boolean).join(" ") || null,
    number: c.number || null,
    variant: c.variant || null,
  };
}

/**
 * The winner's browser keeps a signed cookie from the pull, so a refresh shows their card and the address link again.
 * Anyone else opening the same link sees the normal Case.
 */
export const WINNER_COOKIE = "ts_rr";
function cookieSecret() {
  const s = process.env.PLAYER_SECRET || process.env.TRADE_SHARK_PASSWORD;
  if (!s) throw new Error("PLAYER_SECRET (or TRADE_SHARK_PASSWORD) must be set to sign the Roster Roll cookie.");
  return s;
}
const winnerSig = (date: string, handle: string) => createHmac("sha256", cookieSecret()).update(`roster-roll:${date}:${handle.toLowerCase()}`).digest("hex");
export const winnerCookie = (date: string, handle: string) => `${date}.${winnerSig(date, handle)}`;

/** True when the cookie is this browser's proof that it pulled the single for this date + handle. */
export function isWinner(cookie: string | undefined, date: unknown, handle: unknown): boolean {
  const d = parseDate(date);
  const h = parseHandle(handle);
  if (!cookie || !d || !h) return false;
  const want = Buffer.from(winnerCookie(d, h));
  const got = Buffer.from(cookie);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The single a claimed row gave (for the winner's own refresh and image). */
export async function claimedSingle(date: unknown, handle: unknown): Promise<SingleView | null> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  if (!d || !h) return null;
  const row = await db.rosterRollClaim.findFirst({ where: { ...matchRow(d, h), status: "claimed", cardId: { not: null } } });
  const card = row?.cardId ? await db.card.findUnique({ where: { id: row.cardId }, select: VIEW_SELECT }) : null;
  return row && card ? singleView(row, card) : null;
}


export type RecordResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Roster Roll's write: one winner per New York date, with the link's secret code. Sending the same winner and code
 * again is fine (a retry); anything else for a recorded date is refused.
 */
export async function recordWinner(body: { date?: unknown; handle?: unknown; score?: unknown; code?: unknown }, now = new Date()): Promise<RecordResult> {
  const date = parseDate(body.date);
  const handle = parseHandle(body.handle);
  const score = parseScore(body.score);
  const code = parseCode(body.code);
  if (!date) return { ok: false, status: 400, error: "date must be YYYY-MM-DD (America/New_York)" };
  if (date > nyToday(now)) return { ok: false, status: 400, error: "date is in the future (America/New_York)" };
  if (!handle) return { ok: false, status: 400, error: "handle must be 3–16 characters, no spaces" };
  if (score == null) return { ok: false, status: 400, error: "score must be a whole number ≥ 0" };
  if (!code) return { ok: false, status: 400, error: "code must be 22–64 url-safe characters" };
  try {
    await db.rosterRollClaim.create({ data: { date, handle, score, codeHash: codeHash(code) } });
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const same = await db.rosterRollClaim.findFirst({ where: matchRow(date, handle, code), select: { date: true } });
      return same ? { ok: true } : { ok: false, status: 409, error: "a winner is already recorded for that date" };
    }
    throw e;
  }
}
