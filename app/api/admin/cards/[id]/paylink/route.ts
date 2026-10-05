import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";

export const runtime = "nodejs";

/** Single-card pay links are retired: cards sell only inside packs (relink a pack from /admin/lil-stack). */
export const POST = guarded(async () =>
  NextResponse.json({ ok: false, error: "Cards sell only in packs now. Make a fresh pack link from the Packs page." }, { status: 410 }),
);
