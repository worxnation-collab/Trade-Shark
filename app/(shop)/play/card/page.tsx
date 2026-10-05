import { RULES_LINE } from "@/lib/game/rules";
import { currentBuyer } from "@/lib/game/buyer";
import { TzField } from "./TzField";

export const dynamic = "force-dynamic";
export const metadata = { title: "Save a card · Trade Shark" };

/** Before the first $1 reveal: a saved card (Stripe) and where to ship. */
export default async function SaveCard({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const buyer = await currentBuyer();
  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <div>
        <h1 className="text-3xl font-extrabold">{buyer ? "Change your card" : "Save a card to play"}</h1>
        <p className="mt-2 text-sm text-navy/70">{RULES_LINE}</p>
        <p className="mt-2 text-sm text-navy/70">
          Your card is saved with Stripe so each step is one tap. Nothing is charged until you tap a price. Packs you keep ship to the address below.
        </p>
      </div>
      {error && <p className="rounded bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      <form action="/api/play/signup" method="post" className="card space-y-3 p-4">
        <input type="hidden" name="next" value={next ?? ""} />
        {buyer ? (
          <p className="text-sm">
            Playing as <strong>{buyer.name}</strong>
            {buyer.cardLabel ? ` with ${buyer.cardLabel}` : ""}.
          </p>
        ) : (
          <>
            <TzField />
            <label className="block text-sm">
              Name
              <input name="name" required autoComplete="name" className="input mt-1 w-full" />
            </label>
            <label className="block text-sm">
              Email
              <input name="email" type="email" required autoComplete="email" className="input mt-1 w-full" />
            </label>
            <label className="block text-sm">
              Street
              <input name="line1" required autoComplete="address-line1" className="input mt-1 w-full" />
            </label>
            <label className="block text-sm">
              Apt / unit
              <input name="line2" autoComplete="address-line2" className="input mt-1 w-full" />
            </label>
            <div className="grid grid-cols-[1fr_4rem_6rem] gap-2">
              <label className="block text-sm">
                City
                <input name="city" required autoComplete="address-level2" className="input mt-1 w-full" />
              </label>
              <label className="block text-sm">
                State
                <input name="state" required maxLength={2} autoComplete="address-level1" className="input mt-1 w-full uppercase" />
              </label>
              <label className="block text-sm">
                ZIP
                <input name="postal" required inputMode="numeric" autoComplete="postal-code" className="input mt-1 w-full" />
              </label>
            </div>
          </>
        )}
        <button className="btn-primary w-full py-3">{buyer?.paymentMethodId ? "Use a different card" : "Save my card with Stripe"}</button>
        <p className="text-xs text-navy/50">US addresses only. Card details go straight to Stripe; my shop never sees them.</p>
      </form>
    </div>
  );
}
