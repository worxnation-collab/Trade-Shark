import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { framedImageResponse } from "@/lib/framedImage";
import { claimedSingle, isWinner, WINNER_COOKIE } from "@/lib/rosterRoll";

export const runtime = "nodejs";

/** The framed scan of the single a Roster Roll winner pulled: only for the browser that pulled it (signed cookie). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const date = q.get("date");
  const handle = q.get("handle");
  if (!isWinner((await cookies()).get(WINNER_COOKIE)?.value, date, handle)) return new Response("not found", { status: 404 });
  const single = await claimedSingle(date, handle).catch(() => null);
  const c = single ? await db.card.findUnique({ where: { id: single.id }, select: { id: true, frontImage: true, frontDisplay: true } }) : null;
  if (!c?.frontImage) return new Response("not found", { status: 404 });
  return framedImageResponse(c);
}
