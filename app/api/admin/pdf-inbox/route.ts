import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { pendingPdfs } from "@/lib/ingestInbox";

export const runtime = "nodejs";

/** PDFs the Drive script sent that still need splitting in the browser. */
export const GET = guarded(async () => NextResponse.json({ pdfs: await pendingPdfs() }));
