import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { purgeDemo, purgeSeedImages } from "@/lib/purge";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Remove all seeded / demo cards and the packs built from them. Real scans are never touched. Call until left = 0. */
export const POST = guarded(async () => {
  const r = await purgeDemo();
  const images = r.left === 0 ? await purgeSeedImages().catch(() => 0) : 0;
  return NextResponse.json({ ok: true, ...r, images });
});
