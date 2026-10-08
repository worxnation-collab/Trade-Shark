import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { connectUrl, ebayAppReady } from "@/lib/ebay/seller";

export const runtime = "nodejs";

/** "Connect eBay" on the desk: send the founder to eBay's seller login. */
export const GET = guarded(async (req: Request) => {
  if (!ebayAppReady()) return NextResponse.redirect(new URL("/admin/lil-stack?ebay=noapp#ebay", req.url));
  return NextResponse.redirect(await connectUrl());
});
