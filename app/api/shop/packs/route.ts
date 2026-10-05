import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ids of packs still open, so Shuffle can skip one that sold while the page was up. */
export async function GET() {
  const open = await db.lilStack.findMany({ where: { status: "open" }, select: { id: true } });
  return NextResponse.json({ open: open.map((p) => p.id) }, { headers: { "Cache-Control": "no-store" } });
}
