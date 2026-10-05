import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { refreshPacks } from "@/lib/lilStack";

export const runtime = "nodejs";

/** Sort cards, retire old links, and draw new game packs from every category's bins. */
export const POST = guarded(async () => NextResponse.json(await refreshPacks()));
