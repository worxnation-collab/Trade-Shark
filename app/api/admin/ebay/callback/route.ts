import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { finishConnect } from "@/lib/ebay/seller";

export const runtime = "nodejs";

/** eBay sends the founder back here (the RuName's accept URL) with a one-time code. */
export const GET = guarded(async (req: Request) => {
  const u = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/lil-stack?ebay=${q}#ebay`, req.url));
  const code = u.searchParams.get("code");
  if (!code) return back("declined");
  try {
    await finishConnect(code, u.searchParams.get("state") ?? "");
    return back("connected");
  } catch (e) {
    console.error("ebay connect", e instanceof Error ? e.message : e);
    return back("failed");
  }
});
