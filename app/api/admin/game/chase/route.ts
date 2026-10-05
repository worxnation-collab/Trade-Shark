import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { isCategory } from "@/lib/categories";
import { setChase } from "@/lib/game/packs";

export const runtime = "nodejs";

/** Turn chase cards on or off for one category. On needs at least one $10+ card scanned in it. */
export const POST = guarded(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { category?: string; on?: boolean };
  if (!isCategory(b.category)) return NextResponse.json({ ok: false, error: "category" }, { status: 400 });
  try {
    await setChase(b.category, !!b.on);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
});
