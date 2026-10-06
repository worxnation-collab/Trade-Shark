import { currentBuyer } from "@/lib/game/buyer";
import { shipQuote } from "@/lib/game/play";
import { json, play } from "../_util";

export const runtime = "nodejs";

/** The one shipping line for the player's next pack (the blind pack button shows it before they pay). */
export const POST = play(async () => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Save a card to play." }, 401);
  return json(await shipQuote(buyer));
});
