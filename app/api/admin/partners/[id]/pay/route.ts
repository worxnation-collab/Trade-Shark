import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { payPartner } from "@/lib/partners";
import { isPartner } from "@/lib/partners/split";

export const runtime = "nodejs";

/** Pay the partner's whole owed balance with one Stripe Connect transfer. Only ever by hand. */
export const POST = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!isPartner(id)) return NextResponse.json({ ok: false, error: "No such partner." }, { status: 404 });
  const r = await payPartner(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
});
