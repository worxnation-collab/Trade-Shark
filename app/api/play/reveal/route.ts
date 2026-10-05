import { currentBuyer } from "@/lib/game/buyer";
import { reveal } from "@/lib/game/play";
import { json, play, statusFor } from "../_util";

export const runtime = "nodejs";

export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Save a card to play.", code: "no-card" }, 402);
  const { category } = (await req.json().catch(() => ({}))) as { category?: string };
  const r = await reveal(buyer, String(category ?? ""));
  return json(r, r.ok ? 200 : statusFor(r.code));
});
