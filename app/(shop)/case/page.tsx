import Link from "next/link";
import { caseCards } from "@/lib/caseStock";
import { canPull } from "@/lib/rosterRoll";
import { CaseReel } from "./CaseReel";
import { RosterRollPull } from "./RosterRollPull";

export const dynamic = "force-dynamic";
export const metadata = { title: "The case · Trade Shark" };

/** The case: real cards from my stock drifting by. Look only; packs are the only thing for sale. */
export default async function CasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  // A Roster Roll winner's link adds one line above the drift; any other link, or a used one, leaves the page as it is.
  const reward = q.reward === "roster-roll" && typeof q.date === "string" && typeof q.handle === "string" ? { date: q.date, handle: q.handle } : null;
  const [cards, offer] = await Promise.all([caseCards().catch(() => []), reward ? canPull(reward.date, reward.handle).catch(() => false) : false]);
  return (
    <section className="-mx-4 -my-8 sm:-my-10">
      <div className="px-4 pb-3 pt-6 text-center">
        <h1 className="font-display text-3xl tracking-tight text-navy sm:text-4xl">The case</h1>
        <div className="gold-rule mx-auto mt-2" aria-hidden />
        <p className="mx-auto mt-3 max-w-md text-sm text-navy/70">
          Real cards from my stock, drifting by. Tap one for a closer look. Cards aren&apos;t sold one by one: they turn up in{" "}
          <Link href="/" className="underline">
            packs
          </Link>
          .
        </p>
      </div>
      {offer && reward && <RosterRollPull date={reward.date} handle={reward.handle} />}
      {cards.length ? <CaseReel cards={cards} /> : <p className="px-4 py-16 text-center text-navy/60">The case is being restocked.</p>}
    </section>
  );
}
