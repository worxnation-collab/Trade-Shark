import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { consignOpen } from "@/lib/partners";

export const runtime = "nodejs";

/** Add an outside sender (consignment). Only while consignment is open. */
export const POST = guarded(async (req: Request) => {
  if (!(await consignOpen())) return NextResponse.json({ ok: false, error: "Consignment is locked." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; email?: string };
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ ok: false, error: "A sender needs a name." }, { status: 400 });
  const s = await db.sender.create({ data: { name, email: String(b.email ?? "").trim().slice(0, 120) || null } });
  return NextResponse.json({ ok: true, id: s.id });
});
