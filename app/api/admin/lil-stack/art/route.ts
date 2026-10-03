import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { ART_KINDS, generateArt, type ArtKind } from "@/lib/brandArt";

export const runtime = "nodejs";
export const maxDuration = 26;

/** Generate one pack image (?kind=closed|open). One per request keeps each call under the function timeout. */
export const POST = guarded(async (req: Request) => {
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  if (!(ART_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ ok: false, reason: "kind must be closed or open" }, { status: 400 });
  const r = await generateArt(kind as ArtKind);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
});
