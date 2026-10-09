import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Mark a sold card or Lil' Stack shipped. Bubble mailers take a tracking number; envelopes have none. */
export const POST = guarded(async (req: Request) => {
  const b = (await req.json()) as { kind?: string; id?: string; tracking?: string };
  if (!b.id || !["card", "stack", "game", "parcel"].includes(b.kind ?? "")) return NextResponse.json({ ok: false, error: "kind (card|stack|game|parcel) and id required" }, { status: 400 });
  if (b.kind === "parcel") {
    // The label already carries tracking; this just records the drop-off.
    const o = await db.shipOrder.findUnique({ where: { id: b.id } });
    if (!o?.labelPath) return NextResponse.json({ ok: false, error: "Buy the label first." }, { status: 400 });
    await db.shipOrder.update({ where: { id: b.id }, data: { shippedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  if (b.kind === "game") {
    // Reveal-game packs ship in a tracked bubble mailer.
    const p = await db.gamePack.findUnique({ where: { id: b.id } });
    if (!p || !["kept", "sold-blind"].includes(p.status)) return NextResponse.json({ ok: false, error: "Only a sold pack can ship." }, { status: 400 });
    const tracking = (b.tracking ?? "").trim();
    if (!tracking) return NextResponse.json({ ok: false, error: "A bubble mailer needs its tracking number." }, { status: 400 });
    await db.gamePack.update({ where: { id: b.id }, data: { trackingNumber: tracking, shippedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
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
