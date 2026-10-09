import { cookies } from "next/headers";
import { isPublicCategory } from "@/lib/categories";
import { currentBuyer, ipKey, newGuest, PLAYER_COOKIE, PLAYER_COOKIE_OPTS, playerToken } from "@/lib/game/buyer";
import { look } from "@/lib/game/play";
import { isValidZone } from "@/lib/game/rules";
import { json, play, statusFor } from "../_util";

export const runtime = "nodejs";

/** Show me the cards. Free; a signed-out visitor gets a guest player (cookie) on their first look. */
export const POST = play(async (req: Request) => {
  const { category, memberStack, tz } = (await req.json().catch(() => ({}))) as { category?: string; memberStack?: boolean; tz?: string };
  if (!isPublicCategory(category)) return json({ ok: false, error: "That pack isn't open.", code: "closed" }, statusFor("closed"));
  const zone = isValidZone(tz) ? tz : "America/New_York";
  const buyer = (await currentBuyer()) ?? (await newGuest(zone));
  (await cookies()).set(PLAYER_COOKIE, playerToken(buyer.id), PLAYER_COOKIE_OPTS);
  const r = await look(buyer, category, { memberStack: !!memberStack, ip: ipKey(req.headers), tz: zone });
  return json(r, r.ok ? 200 : statusFor(r.code));
});
