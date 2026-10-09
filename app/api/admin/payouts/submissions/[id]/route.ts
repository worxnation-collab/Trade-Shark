import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { consignOpen } from "@/lib/partners";

export const runtime = "nodejs";

/** Accept (makes the sender) or decline a public consignment request. Accepting is refused while consignment is locked. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const sub = await db.consignSubmission.findUnique({ where: { id } });
  if (!sub || sub.status !== "pending") return NextResponse.json({ ok: false, error: "That request is already handled." }, { status: 409 });
  if (action === "decline") {
    await db.consignSubmission.update({ where: { id }, data: { status: "declined" } });
    return NextResponse.json({ ok: true });
  }
  if (action !== "accept") return NextResponse.json({ ok: false, error: "accept or decline" }, { status: 400 });
  if (!(await consignOpen())) return NextResponse.json({ ok: false, error: "Consignment is locked. Can't accept a sender yet." }, { status: 403 });
  const s = await db.sender.create({ data: { name: sub.name, email: sub.email } });
  await db.consignSubmission.update({ where: { id }, data: { status: "accepted", senderId: s.id } });
  return NextResponse.json({ ok: true, senderId: s.id });
});
