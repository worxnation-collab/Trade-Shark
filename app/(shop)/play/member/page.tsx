import Link from "next/link";
import { db } from "@/lib/db";
import { currentBuyer } from "@/lib/game/buyer";
import { isMember, MEMBER_PERKS, MEMBER_PRICE, periodKey, refreshMember } from "@/lib/game/member";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membership · Trade Shark" };

/** Optional membership. Plain about what it is and what it isn't. */
export default async function MemberPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const raw = await currentBuyer();
  const buyer = raw ? await refreshMember(raw, true) : null;
  const member = isMember(buyer);
  const used = buyer && member ? await db.memberPerk.findMany({ where: { buyerId: buyer.id, period: periodKey(buyer) } }) : [];
  const usedKind = (k: string) => used.some((u) => u.kind === k);
  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <div>
        <h1 className="text-3xl font-extrabold">Membership</h1>
        <p className="mt-1 text-lg font-semibold text-navy">${MEMBER_PRICE.toFixed(2)} a month, optional.</p>
      </div>
      {error && <p className="rounded border border-navy/20 bg-white p-3 text-sm text-navy">{error}</p>}
      <div className="card space-y-2 p-4">
        <h2 className="font-bold">What you get</h2>
        <ul className="space-y-1 text-sm">
          {MEMBER_PERKS.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-navy">✓</span>
              {p}
            </li>
          ))}
        </ul>
        <h2 className="pt-2 font-bold">What it isn&apos;t</h2>
        <p className="text-sm text-navy/70">No extra reveals, no cheaper everyday packs, and no free shipping on every pack. Reveals are still $1 and packs still cost what they cost.</p>
      </div>

      {!buyer || !buyer.paymentMethodId ? (
        <Link href="/play/card" className="btn-reveal block py-3 text-center">
          Save a card first
        </Link>
      ) : member ? (
        <div className="card space-y-2 p-4 text-sm">
          <p>
            You&apos;re a member{buyer.memberUntil ? ` through ${buyer.memberUntil.toLocaleDateString()}` : ""}
            {buyer.memberCancelAtEnd ? " (cancels then)" : " (renews then)"}.
          </p>
          <p className="text-navy/70">
            This month: mailer credit {usedKind("mailer") ? "used" : "ready"} · member stack {usedKind("stack") ? "used" : "ready"}.
          </p>
          <form action="/api/play/member/cancel" method="post">
            {buyer.memberCancelAtEnd && <input type="hidden" name="resume" value="1" />}
            <button className="btn-ghost mt-1">{buyer.memberCancelAtEnd ? "Keep my membership" : "Cancel at the end of this month"}</button>
          </form>
        </div>
      ) : (
        <form action="/api/play/member/join" method="post">
          <button className="btn-reveal w-full py-3 text-base">Join for ${MEMBER_PRICE.toFixed(2)}/month</button>
          <p className="mt-2 text-center text-xs text-navy/50">Billed monthly by Stripe to your saved card&apos;s account. Cancel any time; perks last to the end of the month.</p>
        </form>
      )}
      <p className="text-center text-sm">
        <Link href="/" className="underline">
          Back to packs
        </Link>
      </p>
    </div>
  );
}
