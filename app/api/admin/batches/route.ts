import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { isPartner } from "@/lib/partners/split";

export const POST = guarded(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; partnerId?: string };
  // Every card is tagged to a partner on upload; no tag, no upload.
  if (!isPartner(body.partnerId)) return NextResponse.json({ error: "Pick whose cards these are (Matthew, Adrian or Mike)." }, { status: 400 });
  const name = body.name?.trim() || `Batch ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
  const batch = await db.batch.create({ data: { name, partnerId: body.partnerId } });
  return NextResponse.json({ id: batch.id });
});
