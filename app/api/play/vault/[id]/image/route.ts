import { db } from "@/lib/db";
import { framedImageResponse } from "@/lib/framedImage";
import { currentBuyer } from "@/lib/game/buyer";

export const runtime = "nodejs";

/** A vault single's framed scan, only for the player whose vault it's in (and only while it's theirs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const buyer = await currentBuyer();
  if (!buyer) return new Response("not found", { status: 404 });
  const item = await db.vaultItem.findFirst({ where: { id: (await params).id, buyerId: buyer.id, status: { in: ["in_vault", "ship_requested", "shipped"] } }, select: { cardId: true } });
  const c = item ? await db.card.findUnique({ where: { id: item.cardId }, select: { id: true, frontImage: true, frontDisplay: true } }) : null;
  if (!c?.frontImage) return new Response("not found", { status: 404 });
  return framedImageResponse(c);
}
