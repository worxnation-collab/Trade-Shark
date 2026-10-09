import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

/** The parcel's USPS label PDF (private; admin only). */
export const GET = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const o = await db.shipOrder.findUnique({ where: { id }, select: { labelPath: true } });
  const buf = o?.labelPath ? await getObject(o.labelPath) : null;
  if (!buf) return new Response("no label yet", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="label-${id}.pdf"`, "Cache-Control": "private, no-store" } });
});
