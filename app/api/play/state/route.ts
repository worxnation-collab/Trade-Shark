import { isPublicCategory } from "@/lib/categories";
import { currentBuyer, ipKey } from "@/lib/game/buyer";
import { playState } from "@/lib/game/play";
import { json, play } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = play(async (req: Request) => {
  const category = new URL(req.url).searchParams.get("category");
  if (!isPublicCategory(category)) return json({ ok: false, error: "category" }, 400);
  return json({ ok: true, ...(await playState(await currentBuyer(), category, ipKey(req.headers))) });
});
