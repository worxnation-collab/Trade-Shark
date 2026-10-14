import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/** Lowercase, 3–16 letters, numbers, underscores. */
export const USER_RE = /^[a-z0-9_]{3,16}$/;

export function normalizeUser(raw: string) {
  return raw.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function checkPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [kind, salt, hex] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hex) return false;
  const hash = (await scrypt(password, salt, 32)) as Buffer;
  const a = Buffer.from(hex, "hex");
  if (a.length !== hash.length) return false;
  return timingSafeEqual(a, hash);
}
