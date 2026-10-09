import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { buyAndStoreLabel } from "@/lib/game/ship";

export const runtime = "nodejs";

/** Buy the label from the order (after a failed Shippo rate charged the $5.95 fallback, or a failed buy). */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const o = await buyAndStoreLabel(id);
  if (req.headers.get("accept")?.includes("application/json")) return NextResponse.json({ ok: !!o.labelPath, error: o.labelError ?? undefined });
  return NextResponse.redirect(new URL("/admin/orders", req.url), 303);
});
