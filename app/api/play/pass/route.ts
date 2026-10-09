import { currentBuyer } from "@/lib/game/buyer";
import { pass } from "@/lib/game/play";
import { json, play } from "../_util";

export const runtime = "nodejs";

/** Pass, or the page going away (sent with navigator.sendBeacon, so it may arrive as text/plain). Never charges. */
export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Not signed in." }, 401);
  let cycleId = "";
  try {
    cycleId = String((JSON.parse(await req.text()) as { cycleId?: string }).cycleId ?? "");
  } catch {
    /* empty body */
  }
  const r = await pass(buyer, cycleId);
  return json(r, r.ok ? 200 : 400);
});
