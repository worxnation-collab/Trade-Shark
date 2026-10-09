import { currentBuyer } from "@/lib/game/buyer";
import { sellBack, sellBackQuote } from "@/lib/game/vault";
import { json, play } from "../../../_util";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Sell-back, step 1: what this vault single would pay in store credit. Only the owner's in-vault rows. */
export const GET = play(async (_req: Request, { params }: Ctx) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "That single isn't in your vault." }, 404);
  const q = await sellBackQuote(buyer.id, (await params).id);
  if (!q) return json({ ok: false, error: "That single isn't in your vault." }, 404);
  return json({ ok: true, ...q });
});

/** Sell-back, step 2 (they confirmed): store credit in, card back to stock. */
export const POST = play(async (_req: Request, { params }: Ctx) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "That single isn't in your vault." }, 404);
  const r = await sellBack(buyer.id, (await params).id);
  return json(r, r.ok ? 200 : 409);
});
