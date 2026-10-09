import { currentBuyer } from "@/lib/game/buyer";
import { shipStored } from "@/lib/game/ship";
import { json, play, statusFor } from "../../_util";

export const runtime = "nodejs";

/** Collection → Ship, step 2: charge the quoted shipping only and buy one label for the whole selection. */
export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Save a card to play." }, 401);
  const { quoteId } = (await req.json().catch(() => ({}))) as { quoteId?: string };
  const r = await shipStored(buyer, String(quoteId ?? ""));
  return json(r, r.ok ? 200 : statusFor(r.code));
});
