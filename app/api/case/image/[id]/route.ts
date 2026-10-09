import { caseWhere } from "@/lib/caseStock";
import { db } from "@/lib/db";
import { framedImageResponse } from "@/lib/framedImage";

export const runtime = "nodejs";

/** The framed scan of a card in The case. Only loose stock: once a pack takes the card, this 404s. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.card.findFirst({ where: { id, ...caseWhere }, select: { id: true, frontImage: true, frontDisplay: true } });
  if (!c?.frontImage) return new Response("not found", { status: 404 });
  return framedImageResponse(c);
}
