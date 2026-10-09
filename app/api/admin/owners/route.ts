import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { consignOpen } from "@/lib/partners";
import { PARTNERS } from "@/lib/partners/split";

/** Who a card can be tagged to: the three founders, and (only while consignment is open) the senders. */
export const GET = guarded(async () => {
  const open = await consignOpen();
  const senders = open ? await db.sender.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  return NextResponse.json({ founders: PARTNERS, senders, consignOpen: open });
});
