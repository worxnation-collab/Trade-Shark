import Link from "next/link";
import { notFound } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { db } from "@/lib/db";
import { CONDITION_LONG, friendly } from "@/lib/listing/templates";
import { getSettings } from "@/lib/settings";
import { checkoutLine } from "@/lib/shipping";
import { cardLabel, cardShipQuote, mailtoFor, PUBLIC_CARD_SELECT } from "@/lib/shop";
import { FOR_SALE } from "@/lib/types";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let c;
  try {
    c = await db.card.findUnique({ where: { id }, select: PUBLIC_CARD_SELECT });
  } catch (e) {
    console.error("card query failed", e);
    return <ShopUnavailable />;
  }
  if (!c || !FOR_SALE.includes(c.status as never) || c.listPrice == null) notFound();
  const ship = cardShipQuote(c, await getSettings());
  const ebay = c.listedChannel === "ebay" && c.listedUrl ? c.listedUrl : null;
  const pay = c.paymentLinkActive && c.paymentLinkUrl ? c.paymentLinkUrl : null;
  return (
    <div className="space-y-4">
      <Link href="/shop" className="text-sm font-semibold text-teal">← Back to the shop</Link>
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
          {c.description && <p className="whitespace-pre-line text-sm text-navy/80">{friendly(c.description)}</p>}
          <div className="rounded-lg bg-sand-2/60 px-3 py-2 text-sm">
            <div className="font-semibold">{checkoutLine(c.listPrice, ship, "Card")}</div>
            <div className="text-xs text-navy/60">
              {ship.free ? `Free ${ship.label.toLowerCase()}` : ship.label}
              {ship.tracked ? ", tracked, ships from Florida" : ", no tracking"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {pay ? (
              <a href={pay} className="btn-coral px-6 py-3 text-base" data-pop>
                Buy this card
              </a>
            ) : (
              <a href={mailtoFor(c)} className="btn-coral px-6 py-3 text-base" data-pop>
                Email to buy
              </a>
            )}
            {ebay && (
              <a href={ebay} target="_blank" rel="noopener noreferrer" className="btn-ghost px-4 py-3">
                Also on eBay ↗
              </a>
            )}
          </div>
          {pay && <p className="text-xs text-navy/50">Secure checkout by Stripe. One of one: when it sells, it&apos;s gone.</p>}
          <Disclaimer className="border-t border-navy/10 pt-3" />
        </div>
      </div>
    </div>
  );
}
