import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { consignOpen } from "@/lib/partners";
import { parseOwner } from "@/lib/partners/split";

export const POST = guarded(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; owner?: string };
  // Every card is tagged to an owner on upload; no tag, no upload.
  const owner = parseOwner(body.owner);
  if (!owner) return NextResponse.json({ error: "Pick whose cards these are: a founder (Matthew, Adrian, Mike) or a consignment sender." }, { status: 400 });
  if (owner.senderId && (!(await consignOpen()) || !(await db.sender.findUnique({ where: { id: owner.senderId } }))))
    return NextResponse.json({ error: "Consignment is locked. Only founder cards can be uploaded." }, { status: 403 });
  const name = body.name?.trim() || `Batch ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
  const batch = await db.batch.create({ data: { name, partnerId: owner.partnerId, senderId: owner.senderId } });
  return NextResponse.json({ id: batch.id });
});
