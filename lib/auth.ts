/**
 * Single-password gate. The session cookie is an HMAC of a fixed message keyed by
 * TRADE_SHARK_PASSWORD, so changing the password logs everyone out. Edge-safe (Web Crypto).
 */
export const COOKIE = "ts_session";

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function passwordConfigured() {
  return !!process.env.TRADE_SHARK_PASSWORD;
}

export async function sessionToken() {
  const pw = process.env.TRADE_SHARK_PASSWORD;
  if (!pw) return null;
  return hmac(pw, "trade-shark-session-v1");
}

export async function isValidSession(value: string | undefined) {
  if (!value) return false;
  const t = await sessionToken();
  if (!t || t.length !== value.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ value.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string) {
  const pw = process.env.TRADE_SHARK_PASSWORD;
  if (!pw) return false;
  // Compare HMACs so timing doesn't leak length/prefix.
  return (await hmac(pw, input)) === (await hmac(pw, pw));
}
