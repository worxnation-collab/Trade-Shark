import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { turnCard, type Deg } from "@/lib/orient";

export const runtime = "nodejs";

/** Admin fallback: turn a card by hand (?deg=90|180|270, clockwise). Front and back turn together, saved in place. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const deg = Number(new URL(req.url).searchParams.get("deg"));
  if (![90, 180, 270].includes(deg)) return NextResponse.json({ ok: false, error: "deg must be 90, 180 or 270" }, { status: 400 });
  const card = await turnCard(await db.card.findUniqueOrThrow({ where: { id } }), deg as Deg);
  return NextResponse.json({ ok: true, card });
});
