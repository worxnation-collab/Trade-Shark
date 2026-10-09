"use client";

import Link from "next/link";
import { useState } from "react";
import { isShiny } from "@/lib/shiny";
import type { SingleView } from "@/lib/rosterRollLink";
import { BIG_TILT, TiltCard } from "../packs/[category]/TiltCard";

const details = (c: SingleView) => [c.setName, c.number ? `#${c.number.replace(/^#/, "")}` : null, c.variant].filter(Boolean).join(" · ");

/**
 * A Roster Roll winner's line above the drift. "Pull it." takes one free single and shows it the way a pack reveal
 * shows its best card. It goes into their vault (Collection) and never ships on its own. If the pull doesn't go through (already pulled, nothing to give) the
 * line simply goes away. `pulled`: the winner came back (refresh), so show their card straight away.
 */
export function RosterRollPull({ date, handle, pulled = null }: { date: string; handle: string; pulled?: SingleView | null }) {
  const [state, setState] = useState<"offer" | "busy" | "gone">("offer");
  const [card, setCard] = useState<SingleView | null>(pulled);

  async function pull() {
    setState("busy");
    const r = await fetch("/api/roster-roll/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, handle, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) })
      .then((x) => x.json())
      .catch(() => null);
    if (r?.ok && r.card) setCard(r.card as SingleView);
    else setState("gone");
  }

  if (card) {
    const q = new URLSearchParams({ date, handle }).toString();
    return (
      <div className="flex flex-col items-center px-4 pb-6 text-center">
        <div className="card-in w-full max-w-[18rem]" style={{ "--i": 0 } as React.CSSProperties}>
          <TiltCard src={`/api/roster-roll/image?${q}`} alt={card.name} max={BIG_TILT} shine={isShiny(card.variant)} />
        </div>
        <p className="mt-3 text-lg font-semibold text-navy">{card.name}</p>
        {details(card) && <p className="text-sm text-navy/70">{details(card)}</p>}
        <p className="mt-4 text-base text-navy">That&apos;s the single. It&apos;s in your vault, and nothing ships until you say so.</p>
        <Link href="/collection" className="mt-2 text-base text-navy underline">
          Ship it or sell it back from your collection.
        </Link>
      </div>
    );
  }
  if (state === "gone") return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 px-4 pb-4 text-center">
      <p className="text-base font-semibold text-navy">Roster Roll winner. One free single.</p>
      <button className="btn-reveal px-5 py-2" disabled={state === "busy"} onClick={pull} data-pop>
        Pull it.
      </button>
    </div>
  );
}
