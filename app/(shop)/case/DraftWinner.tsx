import { POKEROLL_URL } from "@/lib/rosterRollLink";

type Winner = { date: string; handle: string; score: number; pulled: boolean; yesterday: boolean } | null;

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One quiet line under the case title: the Pokéroll daily winner (a real card from this case), or "Be today's winner". */
export function DraftWinner({ winner }: { winner: Winner }) {
  return (
    <p className="mx-auto max-w-md px-4 pb-4 text-center text-sm text-navy">
      {winner ? (
        <>
          <span className="font-semibold">Pokéroll winner{winner.yesterday ? ` · ${day(winner.date)}` : ""}:</span> {winner.handle} · {winner.score}.{" "}
          {winner.pulled ? "Their free card came from this case." : "A free card from this case is waiting for them."}{" "}
        </>
      ) : (
        <>
          <span className="font-semibold">Be today&apos;s winner.</span> Top Pokéroll score each day gets a free card from this case.{" "}
        </>
      )}
      <a href={POKEROLL_URL} target="_blank" rel="noopener noreferrer" className="underline">
        Play the draft
      </a>
    </p>
  );
}
