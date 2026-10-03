import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getFeatured, isFeatured, setFeatured } from "@/lib/featured";

export const runtime = "nodejs";

/** Pin this card to the home hero (?on=0 to unpin). A pin beats the wow score while the card is live. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const on = new URL(req.url).searchParams.get("on") !== "0";
  if (on) await setFeatured({ kind: "card", id });
  else if (isFeatured(await getFeatured(), "card", id)) await setFeatured(null);
  return NextResponse.json({ ok: true, featured: on });
});
