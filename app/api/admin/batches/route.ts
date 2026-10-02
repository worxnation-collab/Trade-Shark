import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";

export const POST = guarded(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim() || `Batch ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
  const batch = await db.batch.create({ data: { name } });
  return NextResponse.json({ id: batch.id });
});
