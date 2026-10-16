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

const matchRow = (date: string, handle: string, code?: string, kind = "lineup") => ({
  date,
  kind,
  handle: { equals: handle, mode: "insensitive" as const },
  ...(code ? { codeHash: codeHash(code) } : {}),
});

export function parseKind(v: unknown): "lineup" | "slot" | "pack" {
  return v === "slot" || v === "pack" ? v : "lineup";
}

/** True when this link should offer the pull: a matching unclaimed row (code included) and at least one card to give. */
export async function canPull(date: unknown, handle: unknown, code: unknown, kind?: unknown): Promise<boolean> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  const c = parseCode(code);
  if (!d || !h || !c) return false;
  const game = parseKind(kind);
  const stock = () => db.card.count({ where: SINGLE_WHERE }).then((n) => n > 0);
  try {
    const row = await db.rosterRollClaim.findFirst({ where: { ...matchRow(d, h, c, game), status: "unclaimed" }, select: { date: true } });
    if (row) return stock();
  } catch {
    /* The claim table couldn't be queried (the runtime role can't migrate it). The setting row below still counts. */
  }
  const rec = await readPrize(d, game);
  return !!rec && prizeMatches(rec, h, c, "unclaimed") && stock();
}


class NoStock extends Error {}

/**
 * Pull the single: flip the row to claimed, reserve one random card and put it in the winner's vault, in one
 * transaction. The card is not sold and nothing ships: it sits as Vaulted under `buyerId` until they ship it or sell
 * it back. Returns null when the link doesn't match an unclaimed row (a second pull) or there is nothing to give;
 * nothing changes then.
 */
export async function pullSingle(date: unknown, handle: unknown, code: unknown, buyerId: string, now = new Date(), kind?: unknown): Promise<SingleView | null> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  const c = parseCode(code);
  const game = parseKind(kind);
  if (!d || !h || !c) return null;
  const sourceRef = game === "lineup" ? d : `${d}:${game}`;
  try {
    const roster = await db.$transaction(async (tx) => {
      const flip = await tx.rosterRollClaim.updateMany({ where: { ...matchRow(d, h, c, game), status: "unclaimed" }, data: { status: "claimed", claimedAt: now } });
      if (!flip.count) return null;
      for (let tries = 0; tries < 5; tries++) {
        const n = await tx.card.count({ where: SINGLE_WHERE });
        if (!n) break;
        const pick = await tx.card.findFirst({ where: SINGLE_WHERE, orderBy: { id: "asc" }, skip: Math.floor(Math.random() * n), select: { id: true } });
        if (!pick) continue;
        const item = await vaultCard(tx, { buyerId, cardId: pick.id, where: SINGLE_WHERE, source: "roster-roll", sourceRef, now });
        if (!item) continue;
        await tx.rosterRollClaim.updateMany({ where: matchRow(d, h, c, game), data: { cardId: pick.id, buyerId } });
        const row = await tx.rosterRollClaim.findFirst({ where: matchRow(d, h, c, game) });
        if (!row) return null;
        return singleView(row, await tx.card.findUniqueOrThrow({ where: { id: pick.id }, select: VIEW_SELECT }));
      }
      throw new NoStock();
    });
    if (roster) return roster;
  } catch (e) {
    if (e instanceof NoStock) return null;
    const via = await pullSettingPrize(d, h, c, game, buyerId, now).catch(() => null);
    if (via) return via;
    throw e;
  }
  return pullSettingPrize(d, h, c, game, buyerId, now);
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
export async function claimedSingle(date: unknown, handle: unknown, kind?: unknown): Promise<SingleView | null> {
  const d = parseDate(date);
  const h = parseHandle(handle);
  if (!d || !h) return null;
  const game = parseKind(kind);
  try {
    const row = await db.rosterRollClaim.findFirst({ where: { ...matchRow(d, h, undefined, game), status: "claimed", cardId: { not: null } } });
    const card = row?.cardId ? await db.card.findUnique({ where: { id: row.cardId }, select: VIEW_SELECT }) : null;
    if (row && card) return singleView(row, card);
  } catch {
    /* same as canPull: a claim stored beside the table still has a card */
  }
  const rec = await readPrize(d, game);
  if (!rec || rec.status !== "claimed" || !rec.cardId || rec.handle.toLowerCase() !== h.toLowerCase()) return null;
  const card = await db.card.findUnique({ where: { id: rec.cardId }, select: VIEW_SELECT });
  return card ? singleView({ date: d, handle: rec.handle }, card) : null;
}


/** One day before a YYYY-MM-DD date. */
const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * The newest recorded winner, if it's yesterday's or today's (New York). Public facts only: handle, score, date and
 * whether the card was pulled. Pokéroll records the winner when the day locks at midnight ET, so this is normally
 * yesterday's row; nothing recent = null ("Be today's winner").
 */
export async function recentWinner(now = new Date()) {
  const today = nyToday(now);
  const row = await db.rosterRollClaim.findFirst({
    where: { date: { gte: dayBefore(today), lte: today }, kind: "lineup" },
    orderBy: { date: "desc" },
    select: { date: true, handle: true, score: true, status: true },
  });
  return row ? { date: row.date, handle: row.handle, score: row.score, pulled: row.status === "claimed", yesterday: row.date !== today } : null;
}

export type RecordResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Roster Roll's write: one winner per New York date, with the link's secret code. Sending the same winner and code
 * again is fine (a retry); anything else for a recorded date is refused.
 *
 * The live database role can insert rows but is not the owner of RosterRollClaim, so it cannot ALTER the table.
 * The insert is attempted as-is. If the table still has no per-game column, or that day's only key is already taken
 * by another game, the prize is stored on Setting instead (a table this role already writes) and the pull reads it.
 */
export async function recordWinner(body: { date?: unknown; handle?: unknown; score?: unknown; code?: unknown; kind?: unknown }, now = new Date()): Promise<RecordResult> {
  const date = parseDate(body.date);
  const handle = parseHandle(body.handle);
  const score = parseScore(body.score);
  const code = parseCode(body.code);
  const kind = parseKind(body.kind);
  if (!date) return { ok: false, status: 400, error: "date must be YYYY-MM-DD (America/New_York)" };
  if (date > nyToday(now)) return { ok: false, status: 400, error: "date is in the future (America/New_York)" };
  if (!handle) return { ok: false, status: 400, error: "handle must be 3–16 characters, no spaces" };
  if (score == null) return { ok: false, status: 400, error: "score must be a whole number ≥ 0" };
  if (!code) return { ok: false, status: 400, error: "code must be 22–64 url-safe characters" };
  try {
    await db.rosterRollClaim.create({ data: { date, kind, handle, score, codeHash: codeHash(code) } });
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const same = await db.rosterRollClaim.findFirst({ where: matchRow(date, handle, code, kind), select: { date: true } }).catch(() => null);
      if (same) return { ok: true };
      const taken = await db.rosterRollClaim.findFirst({ where: { date, kind }, select: { date: true } }).catch(() => null);
      if (taken) return { ok: false, status: 409, error: "a winner is already recorded for that game on that date" };
    }
    return recordSettingPrize(date, kind, handle, score, code);
  }
}

type PrizeRec = {
  handle: string;
  score: number;
  status: "unclaimed" | "claimed";
  cardId: string | null;
  buyerId: string | null;
  codeHash: string;
  claimedAt: string | null;
};

const prizeStorageKey = (date: string, kind: string) => `prize:${date}:${kind}`;

function encodePrize(r: PrizeRec) {
  return JSON.stringify({ handle: r.handle, score: r.score, status: r.status, cardId: r.cardId, buyerId: r.buyerId, codeHash: r.codeHash, claimedAt: r.claimedAt });
}

function prizeMatches(rec: PrizeRec, handle: string, code?: string, status?: string) {
  if (rec.handle.toLowerCase() !== handle.toLowerCase()) return false;
  if (code && rec.codeHash !== codeHash(code)) return false;
  if (status && rec.status !== status) return false;
  return true;
}

async function readPrize(date: string, kind: string): Promise<PrizeRec | null> {
  const row = await db.setting.findUnique({ where: { key: prizeStorageKey(date, kind) } }).catch(() => null);
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as PrizeRec;
    return v && typeof v.handle === "string" && typeof v.codeHash === "string" ? v : null;
  } catch {
    return null;
  }
}

async function recordSettingPrize(date: string, kind: string, handle: string, score: number, code: string): Promise<RecordResult> {
  const rec: PrizeRec = { handle, score, status: "unclaimed", cardId: null, buyerId: null, codeHash: codeHash(code), claimedAt: null };
  const existing = await readPrize(date, kind);
  if (existing) {
    return prizeMatches(existing, handle, code) ? { ok: true } : { ok: false, status: 409, error: "a winner is already recorded for that game on that date" };
  }
  try {
    await db.setting.create({ data: { key: prizeStorageKey(date, kind), value: encodePrize(rec) } });
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await readPrize(date, kind);
      if (again && prizeMatches(again, handle, code)) return { ok: true };
      return { ok: false, status: 409, error: "a winner is already recorded for that game on that date" };
    }
    throw e;
  }
}

/** Flip a Setting prize and vault one card. Used when RosterRollClaim cannot store this game. */
async function pullSettingPrize(d: string, h: string, c: string, game: string, buyerId: string, now: Date): Promise<SingleView | null> {
  const rec = await readPrize(d, game);
  if (!rec || !prizeMatches(rec, h, c, "unclaimed")) return null;
  const held = await db.setting.updateMany({
    where: { key: prizeStorageKey(d, game), value: encodePrize(rec) },
    data: { value: encodePrize({ ...rec, status: "claimed", buyerId, claimedAt: now.toISOString() }) },
  });
  if (!held.count) return null;
  const sourceRef = game === "lineup" ? d : `${d}:${game}`;
  try {
    return await db.$transaction(async (tx) => {
      for (let tries = 0; tries < 5; tries++) {
        const n = await tx.card.count({ where: SINGLE_WHERE });
        if (!n) break;
        const pick = await tx.card.findFirst({ where: SINGLE_WHERE, orderBy: { id: "asc" }, skip: Math.floor(Math.random() * n), select: { id: true } });
        if (!pick) continue;
        const item = await vaultCard(tx, { buyerId, cardId: pick.id, where: SINGLE_WHERE, source: "roster-roll", sourceRef, now });
        if (!item) continue;
        await tx.setting.update({
          where: { key: prizeStorageKey(d, game) },
          data: { value: encodePrize({ ...rec, status: "claimed", buyerId, claimedAt: now.toISOString(), cardId: pick.id }) },
        });
        return singleView({ date: d, handle: rec.handle }, await tx.card.findUniqueOrThrow({ where: { id: pick.id }, select: VIEW_SELECT }));
      }
      throw new NoStock();
    });
  } catch (e) {
    if (e instanceof NoStock) {
      await db.setting.update({ where: { key: prizeStorageKey(d, game) }, data: { value: encodePrize(rec) } }).catch(() => {});
      return null;
    }
    throw e;
  }
}
