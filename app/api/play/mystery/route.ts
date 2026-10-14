import { cookies } from "next/headers";
import { isPublicCategory } from "@/lib/categories";
import { siteUrl } from "@/lib/env";
import { currentBuyer, ipKey, newGuest, PLAYER_COOKIE, PLAYER_COOKIE_OPTS, playerToken } from "@/lib/game/buyer";
import { mystery } from "@/lib/game/play";
import { json, play, statusFor } from "../_util";

export const runtime = "nodejs";

/** After three opens today: buy one sealed pack at the mystery price. Saved card, or Stripe Checkout. */
export const POST = play(async (req: Request) => {
  const { category } = (await req.json().catch(() => ({}))) as { category?: string };
  if (!isPublicCategory(category)) return json({ ok: false, error: "That pack isn't open.", code: "closed" }, statusFor("closed"));
  const buyer = (await currentBuyer()) ?? (await newGuest("America/New_York"));
  (await cookies()).set(PLAYER_COOKIE, playerToken(buyer.id), PLAYER_COOKIE_OPTS);
  const r = await mystery(buyer, category, { base: siteUrl() || new URL(req.url).origin, ip: ipKey(req.headers) });
  return json(r, r.ok ? 200 : statusFor(r.code));
});
