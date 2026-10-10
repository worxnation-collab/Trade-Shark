import { cookies } from "next/headers";
import Link from "next/link";
import { caseCards } from "@/lib/caseStock";
import { canPull, claimedSingle, isWinner, recentWinner, WINNER_COOKIE } from "@/lib/rosterRoll";
import { DraftWinner } from "./DraftWinner";
import { CaseReel } from "./CaseReel";
import { RosterRollPull } from "./RosterRollPull";

export const dynamic = "force-dynamic";
export const metadata = { title: "The case · Trade Shark" };

/** The case: real cards from my stock drifting by. Look only; packs are the only thing for sale. */
export default async function CasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  // A Roster Roll winner's link adds one line above the drift; any other link, or a used one, leaves the page as it is.
  // Pokéroll (Roster Roll's new name) links with reward=pokeroll; older links say roster-roll.
  const reward = (q.reward === "roster-roll" || q.reward === "pokeroll") && typeof q.date === "string" && typeof q.handle === "string" ? { date: q.date, handle: q.handle, code: typeof q.code === "string" ? q.code : "" } : null;
  const [cards, offer, winner] = await Promise.all([
    caseCards().catch(() => []),
    reward ? canPull(reward.date, reward.handle, reward.code).catch(() => false) : false,
    recentWinner().catch(() => null),
  ]);
  // The winner's own browser (signed cookie from the pull) keeps their card and the vault link; everyone else sees the plain Case.
  const won =
    reward && !offer && isWinner((await cookies()).get(WINNER_COOKIE)?.value, reward.date, reward.handle)
      ? await claimedSingle(reward.date, reward.handle).catch(() => null)
      : null;
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
      {!(reward && (offer || won)) && <DraftWinner winner={winner} />}
      {reward && (offer || won) && <RosterRollPull date={reward.date} handle={reward.handle} code={reward.code} pulled={won} />}
      {cards.length ? <CaseReel cards={cards} /> : <p className="px-4 py-16 text-center text-navy/60">The case is being restocked.</p>}
    </section>
  );
}
