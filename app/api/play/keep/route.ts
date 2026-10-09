import { currentBuyer } from "@/lib/game/buyer";
import { keep } from "@/lib/game/play";
import { json, play, statusFor } from "../_util";

export const runtime = "nodejs";

export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Save a card to play." }, 401);
  const { cycleId } = (await req.json().catch(() => ({}))) as { cycleId?: string };
  const r = await keep(buyer, String(cycleId ?? ""));
  return json(r, r.ok ? 200 : statusFor(r.code));
});
