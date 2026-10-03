import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Mark a sold card or Lil' Stack shipped. Bubble mailers take a tracking number; envelopes have none. */
export const POST = guarded(async (req: Request) => {
  const b = (await req.json()) as { kind?: string; id?: string; tracking?: string };
  if (!b.id || (b.kind !== "card" && b.kind !== "stack")) return NextResponse.json({ ok: false, error: "kind (card|stack) and id required" }, { status: 400 });
  const order = b.kind === "card" ? await db.card.findUnique({ where: { id: b.id } }) : await db.lilStack.findUnique({ where: { id: b.id } });
  const sold = order && ("status" in order ? order.status === "Sold" || order.status === "sold" : false);
  if (!order || !sold) return NextResponse.json({ ok: false, error: "Only a sold order can ship." }, { status: 400 });
  const method = order.shipMethod ?? order.paymentLinkShipMethod;
  const tracking = method === "pwe" ? null : (b.tracking ?? "").trim() || null;
  if (method !== "pwe" && !tracking) return NextResponse.json({ ok: false, error: "A bubble mailer needs its tracking number." }, { status: 400 });
  const data = { trackingNumber: tracking, shippedAt: new Date() };
  if (b.kind === "card") await db.card.update({ where: { id: b.id }, data });
  else await db.lilStack.update({ where: { id: b.id }, data });
  return NextResponse.json({ ok: true });
});
