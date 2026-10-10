import { PageTitle } from "@/components/Stage";
import { consignOpen } from "@/lib/partners";
import { ConsignForm } from "./ConsignForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send in your bulk" };

/** What consignment will be. Locked = Coming soon, no form, nothing to sign up for. */
export default async function ConsignPage() {
  const open = await consignOpen();
  return (
    <section className="space-y-8">
      <PageTitle title="Send in your bulk">{!open && <p className="text-sm font-bold uppercase tracking-widest text-navy/70">Coming soon</p>}</PageTitle>

      <div className="mx-auto max-w-xl space-y-4 text-navy">
        {!open && (
          <p className="rounded-lg border border-navy/15 bg-white p-4 text-sm font-semibold">
            This isn&apos;t open yet. There&apos;s nothing to sign up for and nothing to mail. Here&apos;s how it will work.
          </p>
        )}
        <ol className="space-y-3">
          {[
            ["Send in bulk.", "Mail a box of your cards to the shop."],
            ["We scan it under your name.", "Every card gets scanned and priced, tagged to you."],
            ["Your cards can be mixed into packs.", "They go into the same Baseball, Football and Pokemon packs as the shop's own cards."],
            ["A pack sells, you're owed that card's price.", "If a pack with your card in it sells, you're owed the scanner price of that card. A $50 card pays $50, not a share of the pack."],
          ].map(([h, t], i) => (
            <li key={h} className="flex gap-3 rounded-lg border border-navy/15 bg-white p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-black text-sand">{i + 1}</span>
              <span>
                <b className="block font-black">{h}</b>
                <span className="text-sm text-navy/75">{t}</span>
              </span>
            </li>
          ))}
        </ol>
        <ul className="space-y-1 text-sm text-navy/75">
          <li>• Payouts open only after the shop&apos;s reserve can cover your card. Until then it waits and isn&apos;t put in a pack.</li>
          <li>• The membership stays with Pokéroll.</li>
          <li>• Scanner prices are a cute-shop estimate, not a market quote.</li>
        </ul>
        {open ? (
          <ConsignForm />
        ) : (
          <p className="border-t border-gold pt-4 text-center text-sm font-bold uppercase tracking-widest text-navy">Coming soon</p>
        )}
      </div>
    </section>
  );
}
