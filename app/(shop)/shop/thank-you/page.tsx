import Link from "next/link";
import { ConfettiOnce } from "@/components/ConfettiOnce";
import { SharkFin } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { cardLabel } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thank you" };

/**
 * Where Stripe sends buyers after checkout. This page only says thanks: it never marks a card
 * Sold (the signed webhook does that), so visiting this URL by hand changes nothing.
 */
export default async function ThankYou({ searchParams }: { searchParams: Promise<{ card?: string }> }) {
  const { card } = await searchParams;
  let label: string | null = null;
  if (card) {
    try {
      const c = await db.card.findUnique({ where: { id: card }, select: { name: true, player: true, setName: true, number: true, year: true } });
      if (c) label = cardLabel(c);
    } catch {
      /* the thanks matters more than the name */
    }
  }
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <ConfettiOnce id={card ?? "order"} />
      <div id="thanks-fin" className="mx-auto mb-4 w-fit">
        <SharkFin size={72} />
      </div>
      <h1 className="text-3xl font-extrabold">Thank you!</h1>
      {label && <p className="mt-2 text-lg font-semibold text-teal-2">{label}</p>}
      <p className="mt-3 text-navy/70">
        Your payment went through and a receipt is on its way from Stripe. I&apos;ll pack the card in a sleeve and top loader and ship it from
        Florida with tracking.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn-primary px-5 py-2.5">Keep browsing</Link>
        <Link href="/contact" className="btn-ghost px-5 py-2.5">Questions?</Link>
      </div>
    </div>
  );
}
