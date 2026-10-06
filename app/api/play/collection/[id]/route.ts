import { db } from "@/lib/db";
import { currentBuyer } from "@/lib/game/buyer";
import { packView } from "@/lib/game/packs";
import { BOUGHT } from "@/lib/game/ship";
import { json, play } from "../../_util";

export const runtime = "nodejs";

/** One bought pack's 12 cards, only for the player who bought it. */
export const GET = play(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Save a card to play." }, 401);
  const pack = await db.gamePack.findFirst({ where: { id, reservedBy: buyer.id, status: { in: BOUGHT } }, select: { id: true } });
  if (!pack) return json({ ok: false, error: "That pack isn't in your collection." }, 404);
  return json({ ok: true, pack: await packView(pack.id) });
});
