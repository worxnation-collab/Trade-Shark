import { HeaderBand } from "@/components/Stage";
import { headerArt, patternArt } from "@/lib/brandAssets";
import { consignOpen } from "@/lib/partners";
import { ConsignForm } from "./ConsignForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send in your bulk · Trade Shark" };

/** What consignment will be. Locked = Coming soon, no form, nothing to sign up for. */
export default async function ConsignPage() {
  const open = await consignOpen();
  const pattern = patternArt();
  return (
    <section className="space-y-8">
      <HeaderBand art={headerArt("consign")}>
        <div className="text-center">
          <h1 className="-rotate-1 rounded-xl border-4 border-sand bg-navy px-5 py-2 text-3xl font-black uppercase tracking-tight text-sand shadow-[5px_5px_0_#d9a441] sm:text-5xl">
            Send in your bulk
          </h1>
          {!open && <p className="mt-3 inline-block rotate-1 rounded-full bg-gold px-4 py-1 text-sm font-black uppercase tracking-widest text-navy">Coming soon</p>}
        </div>
      </HeaderBand>

      <div className="mx-auto max-w-xl space-y-4 text-navy">
        {!open && (
          <p className="rounded-xl border-2 border-navy bg-white p-4 text-sm font-semibold">
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
            <li key={h} className="flex gap-3 rounded-xl border-2 border-navy bg-white p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-black text-gold">{i + 1}</span>
              <span>
                <b className="block font-black">{h}</b>
                <span className="text-sm text-navy/75">{t}</span>
              </span>
            </li>
          ))}
        </ol>
        <ul className="space-y-1 text-sm text-navy/75">
          <li>• Payouts open only after the shop&apos;s reserve can cover your card. Until then it waits and isn&apos;t put in a pack.</li>
          <li>• The $1 peek and the membership stay with Trade Shark.</li>
          <li>• Scanner prices are a cute-shop estimate, not a market quote.</li>
        </ul>
        {open ? (
          <ConsignForm />
        ) : (
          <div className="pattern-band rounded-2xl border-2 border-dashed border-navy/30 p-8 text-center" style={pattern ? { backgroundImage: `url(${pattern})` } : undefined}>
            <p className="inline-block rounded-lg bg-sand px-3 py-1 text-sm font-black uppercase tracking-widest text-navy">Coming soon</p>
          </div>
        )}
      </div>
    </section>
  );
}
