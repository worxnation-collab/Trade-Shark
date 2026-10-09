import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Save the pull sheet's location note (form post from the sheet). */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const f = await req.formData();
  const note = String(f.get("locationNote") ?? "").trim().slice(0, 120);
  await db.gamePack.update({ where: { id }, data: { locationNote: note || null } });
  return NextResponse.redirect(new URL(`/admin/packs/${id}`, req.url), 303);
});
