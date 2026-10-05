import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../db";

/**
 * A player is a Stripe customer with a saved card, held in a signed cookie. No password, no profile page.
 * Locks also follow the card fingerprint, so clearing cookies doesn't reset a category lock.
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
