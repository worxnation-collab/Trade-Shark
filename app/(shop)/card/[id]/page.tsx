import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { CONDITION_LONG } from "@/lib/listing/templates";
import { cardLabel, mailtoFor } from "@/lib/shop";
import { FOR_SALE } from "@/lib/types";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.card.findUnique({ where: { id } });
  if (!c || !FOR_SALE.includes(c.status as never) || c.listPrice == null) notFound();
  const ebay = c.listedChannel === "ebay" && c.listedUrl ? c.listedUrl : null;
  const href = ebay ?? c.listedUrl ?? mailtoFor(c);
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm font-semibold text-teal">← Back to the shop</Link>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/shop/image/${c.id}/front`} alt={`${cardLabel(c)} front`} className="card w-full object-contain" />
          {c.backImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/shop/image/${c.id}/back`} alt={`${cardLabel(c)} back`} className="card w-1/2 object-contain" />
          )}
        </div>
        <div className="space-y-4">
          <h1 className="text-2xl font-extrabold">{cardLabel(c)}</h1>
          <div className="text-3xl font-bold text-teal">{money(c.listPrice)}</div>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-navy/60">Game</dt><dd>{c.game}</dd>
            {c.setName && (<><dt className="text-navy/60">Set</dt><dd>{c.setName}</dd></>)}
            {c.number && (<><dt className="text-navy/60">Number</dt><dd>{c.number}</dd></>)}
            {c.variant && (<><dt className="text-navy/60">Variant</dt><dd>{c.variant}</dd></>)}
            <dt className="text-navy/60">Condition</dt><dd>{c.graded ? `Graded ${c.graded}` : CONDITION_LONG[c.condition]}</dd>
            <dt className="text-navy/60">Quantity</dt><dd>{c.quantity}</dd>
          </dl>
          <p className="text-sm text-navy/70">Photos are of this card. Ships from Florida with tracking.</p>
          <a href={href} target={ebay ? "_blank" : undefined} rel="noopener noreferrer" className="btn-coral px-5 py-2.5 text-base">
            {ebay ? "Buy on eBay" : c.listedUrl ? "View listing" : "Email to buy"}
          </a>
        </div>
      </div>
    </div>
  );
}
