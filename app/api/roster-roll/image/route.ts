import { db } from "@/lib/db";
import { framedImageResponse } from "@/lib/framedImage";
import { claimedCardId } from "@/lib/rosterRoll";

export const runtime = "nodejs";

/** The framed scan of the single a Roster Roll winner pulled: only for the same date + handle as the claimed row. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = await claimedCardId(q.get("date"), q.get("handle")).catch(() => null);
  const c = id ? await db.card.findUnique({ where: { id }, select: { id: true, frontImage: true, frontDisplay: true } }) : null;
  if (!c?.frontImage) return new Response("not found", { status: 404 });
  return framedImageResponse(c);
}
