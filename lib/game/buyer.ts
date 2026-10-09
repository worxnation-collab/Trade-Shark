import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../db";

/**
 * A player is a Buyer held in a signed cookie. No password, no profile page. Looking is free, so a visitor who has
 * never paid is a guest Buyer (no Stripe customer yet, `stripeCustomerId` "guest_…"); the first Keep turns them into
 * a Stripe customer with a saved card. The daily look count also follows the card fingerprint.
 */
export const PLAYER_COOKIE = "ts_player";

function secret() {
  const s = process.env.PLAYER_SECRET || process.env.TRADE_SHARK_PASSWORD;
  if (!s) throw new Error("PLAYER_SECRET (or TRADE_SHARK_PASSWORD) must be set to sign player cookies.");
  return s;
}

const sign = (id: string) => createHmac("sha256", secret()).update(`player:${id}`).digest("hex");

export function playerToken(buyerId: string) {
  return `${buyerId}.${sign(buyerId)}`;
}

export function buyerIdFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const id = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export const PLAYER_COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

export async function currentBuyer() {
  const id = buyerIdFromToken((await cookies()).get(PLAYER_COOKIE)?.value);
  return id ? db.buyer.findUnique({ where: { id } }) : null;
}

/** A guest has looked but never paid: no Stripe customer, no card, no address yet. */
export const GUEST_PREFIX = "guest_";
export const isGuest = (b: { stripeCustomerId: string } | null | undefined) => !!b && b.stripeCustomerId.startsWith(GUEST_PREFIX);

/** A new guest for a signed-out visitor's first look. The cookie is set by the route that made it. */
export async function newGuest(tz: string) {
  return db.buyer.create({ data: { email: "", name: "", shipTo: "{}", tz, stripeCustomerId: `${GUEST_PREFIX}${randomBytes(12).toString("hex")}` } });
}

/** The visitor's network address, hashed (only to cap looks per address; never stored raw). */
export function ipKey(h: Pick<Headers, "get">): string | null {
  const ip = h.get("x-nf-client-connection-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  return ip ? `ip:${createHash("sha256").update(`look:${ip}`).digest("hex").slice(0, 32)}` : null;
}
