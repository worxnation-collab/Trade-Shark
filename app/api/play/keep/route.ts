import { siteUrl } from "@/lib/env";
import { currentBuyer } from "@/lib/game/buyer";
import { keep } from "@/lib/game/play";
import { json, play, statusFor } from "../_util";

export const runtime = "nodejs";

/** Keep: $3.99 on the saved card, or a Stripe Checkout link that saves the card with that payment. */
export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "That pack isn't yours." }, 401);
  const { cycleId } = (await req.json().catch(() => ({}))) as { cycleId?: string };
  const r = await keep(buyer, String(cycleId ?? ""), { base: siteUrl() || new URL(req.url).origin });
  return json(r, r.ok ? 200 : statusFor(r.code));
});
