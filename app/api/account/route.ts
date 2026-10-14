import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPassword, hashPassword, normalizeUser, USER_RE } from "@/lib/game/account";
import { currentBuyer, PLAYER_COOKIE, PLAYER_COOKIE_OPTS, playerToken } from "@/lib/game/buyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINS = new Set(["https://pokeroll.fun", "https://www.pokeroll.fun"]);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  if (!ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

function reply(req: Request, body: Record<string, unknown>, status = 200) {
  const res = NextResponse.json(body, { status, headers: corsHeaders(req) });
  return res;
}

let ready: Promise<void> | null = null;

/** Additive columns. The app role may not be allowed to alter; the SQL file is the fallback. */
function ensureColumns() {
  ready ??= db
    .$executeRawUnsafe(`ALTER TABLE trade_shark."Buyer" ADD COLUMN IF NOT EXISTS "username" TEXT`)
    .then(() => db.$executeRawUnsafe(`ALTER TABLE trade_shark."Buyer" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT`))
    .then(() => db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Buyer_username_key" ON trade_shark."Buyer" ("username")`))
    .then(() => undefined);
  return ready;
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  try {
    await ensureColumns();
    const buyer = await currentBuyer();
    return reply(req, { ok: true, username: buyer?.username ?? null });
  } catch {
    return reply(req, { ok: true, username: null });
  }
}

export async function POST(req: Request) {
  try {
    await ensureColumns();
  } catch (e) {
    console.error("account columns", e);
    return reply(req, { ok: false, error: "Accounts are not ready on the database yet." }, 500);
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string; username?: string; password?: string };
  const username = normalizeUser(body.username ?? "");
  const password = String(body.password ?? "");
  if (!USER_RE.test(username)) return reply(req, { ok: false, error: "Use 3–16 letters, numbers, or underscores." }, 400);
  if (password.length < 8 || password.length > 72) return reply(req, { ok: false, error: "Password needs at least 8 characters." }, 400);

  if (body.action === "login") {
    const buyer = await db.buyer.findUnique({ where: { username } });
    if (!buyer || !(await checkPassword(password, buyer.passwordHash))) {
      return reply(req, { ok: false, error: "That name and password do not match." }, 401);
    }
    const res = reply(req, { ok: true, username });
    res.cookies.set(PLAYER_COOKIE, playerToken(buyer.id), PLAYER_COOKIE_OPTS);
    return res;
  }

  const taken = await db.buyer.findUnique({ where: { username } });
  if (taken) return reply(req, { ok: false, error: "That name is taken. Sign in instead." }, 409);
  const passwordHash = await hashPassword(password);
  const current = await currentBuyer();
  if (current?.username) return reply(req, { ok: false, error: `This device is already ${current.username}. Sign in to switch.` }, 409);
  const buyer = current
    ? await db.buyer.update({ where: { id: current.id }, data: { username, passwordHash } })
    : await db.buyer.create({
        data: {
          email: "",
          name: "",
          shipTo: "{}",
          tz: "America/New_York",
          stripeCustomerId: `guest_${randomBytes(12).toString("hex")}`,
          username,
          passwordHash,
        },
      });
  const res = reply(req, { ok: true, username: buyer.username });
  res.cookies.set(PLAYER_COOKIE, playerToken(buyer.id), PLAYER_COOKIE_OPTS);
  return res;
}
