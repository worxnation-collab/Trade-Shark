import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { consignOpen } from "@/lib/partners";

export const runtime = "nodejs";

/** A public request to mail in bulk. Refused while consignment is locked (the page shows Coming soon). */
export async function POST(req: Request) {
  if (!(await consignOpen())) return NextResponse.json({ ok: false, error: "Consignment isn't open yet." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = (k: string, max: number) => String(b[k] ?? "").trim().slice(0, max);
  const name = t("name", 80);
  const email = t("email", 120);
  const about = t("about", 1000);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !about) return NextResponse.json({ ok: false, error: "Name, email and a few words about your cards, please." }, { status: 400 });
  if ((await db.consignSubmission.count({ where: { email, status: "pending" } })) >= 3) return NextResponse.json({ ok: false, error: "We already have your request." }, { status: 429 });
  await db.consignSubmission.create({ data: { name, email, about } });
  return NextResponse.json({ ok: true });
}
