import Link from "next/link";
import { ConfettiOnce } from "@/components/ConfettiOnce";
import { SharkFin } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { shipFromLink, type ShipQuote } from "@/lib/shipping";
import { cardLabel } from "@/lib/shop";
import { productName } from "@/lib/categories";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thank you" };

/**
 * Where Stripe sends buyers after checkout. This page only says thanks: it never marks a card
 * Sold (the signed webhook does that), so visiting this URL by hand changes nothing.
 */
export default async function ThankYou({ searchParams }: { searchParams: Promise<{ card?: string; stack?: string }> }) {
  const { card, stack } = await searchParams;
  let label: string | null = null;
  // Read-only: this page never records or changes an order (the signed webhook does that).
  let ship: ShipQuote | null = null;
  const SHIP = { shipMethod: true, shippingCharged: true, paymentLinkShipMethod: true, paymentLinkShipping: true } as const;
  if (stack) {
    try {
      const p = await db.lilStack.findUnique({ where: { id: stack }, select: { cardIds: true, category: true, ...SHIP } });
      if (p) label = `${productName(p.category)} · ${p.cardIds.length} cards`;
      if (p) ship = shipFromLink(p.shipMethod ?? p.paymentLinkShipMethod, p.shippingCharged ?? p.paymentLinkShipping);
    } catch {
      /* the thanks matters more than the name */
    }
  }
  if (card) {
    try {
      const c = await db.card.findUnique({ where: { id: card }, select: { name: true, player: true, setName: true, number: true, year: true, ...SHIP } });
      if (c) label = cardLabel(c);
      if (c) ship = shipFromLink(c.shipMethod ?? c.paymentLinkShipMethod, c.shippingCharged ?? c.paymentLinkShipping);
    } catch {
      /* the thanks matters more than the name */
    }
  }
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <ConfettiOnce id={stack ? `stack-${stack}` : (card ?? "order")} />
      <div id="thanks-fin" className="mx-auto mb-4 w-fit">
        <SharkFin size={72} />
      </div>
      <h1 className="text-3xl font-extrabold">Thank you!</h1>
      {label && <p className="mt-2 text-lg font-semibold text-teal-2">{label}</p>}
      <p className="mt-3 text-navy/70">
        Your payment went through and a receipt is on its way from Stripe. I&apos;ll pack {stack ? "every card in sleeves" : "the card in a sleeve and top loader"} and ship{" "}
        {ship ? (
          ship.tracked ? (
            <>in a tracked bubble mailer{ship.free ? " (shipping's on me)" : ""}, tracked from Florida to your door.</>
          ) : (
            <>in a stamped envelope from Florida. Envelopes don&apos;t carry tracking.</>
          )
        ) : (
          <>{stack ? "them" : "it"} from Florida.</>
        )}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn-primary px-5 py-2.5">Keep browsing</Link>
        <Link href="/contact" className="btn-ghost px-5 py-2.5">Questions?</Link>
      </div>
    </div>
  );
}
