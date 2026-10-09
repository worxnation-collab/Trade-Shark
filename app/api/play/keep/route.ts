import { siteUrl } from "@/lib/env";
import { currentBuyer } from "@/lib/game/buyer";
import { keep } from "@/lib/game/play";
import { json, play, statusFor } from "../_util";

export const runtime = "nodejs";

/** Keep: the cycle's stored price on the saved card (an `amount` sent must match it; it's never used), or a Stripe Checkout link that saves the card with that payment. */
export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "That pack isn't yours." }, 401);
  const { cycleId, amount } = (await req.json().catch(() => ({}))) as { cycleId?: string; amount?: unknown };
  const r = await keep(buyer, String(cycleId ?? ""), { base: siteUrl() || new URL(req.url).origin, amount });
  return json(r, r.ok ? 200 : statusFor(r.code));
});
