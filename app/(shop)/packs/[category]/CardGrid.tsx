"use client";

import { useEffect, useState } from "react";
import type { PackView } from "@/lib/game/packs";
import { isShiny } from "@/lib/shiny";
import { BIG_TILT, TiltCard } from "./TiltCard";

const usd = (n: number) => `$${n.toFixed(2)}`;
type PackCard = PackView["cards"][number];

/** Set, number and variant on one line, under the scan (never on it). */
const details = (c: PackCard) => [c.setName, c.number ? `#${c.number.replace(/^#/, "")}` : null, c.variant].filter(Boolean).join(" · ");

function Marks({ c }: { c: PackCard }) {
  return (
    <>
      {c.chase && <span className="ml-1 font-bold">CHASE</span>}
      {c.hit && <span className="ml-1 font-bold">HIT</span>}
      {c.bumped && <span className="ml-1 font-bold">MEMBER</span>}
    </>
  );
}

/**
 * The opened pack. The best card comes first and large, with its name, set, number and variant under it; the other
 * eleven sit in one sideways strip. Thumbs lean ~8°, the big card ~18° (with a highlight only on holo-type finishes).
 * Tap a thumb to see it bigger.
 */
export function CardGrid({ pack }: { pack: PackView }) {
  const [open, setOpen] = useState<string | null>(null);
  const big = pack.cards.find((c) => c.id === open);
  // Cards arrive cheapest first; the best is last.
  const best = pack.cards[pack.cards.length - 1];
  const rest = pack.cards.slice(0, -1).reverse();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  if (!best) return null;
  return (
    <>
      <div className="mt-6 flex w-full flex-col items-center">
        <div id={`card-${best.id}`} className="card-in w-full max-w-[18rem]" style={{ "--i": 0 } as React.CSSProperties}>
          <TiltCard src={`/api/play/image/${best.id}`} alt={best.name} max={BIG_TILT} shine={isShiny(best.variant)} onTap={() => setOpen(best.id)} />
        </div>
        <p className="mt-3 text-lg font-semibold text-navy">{best.name}</p>
        {details(best) && <p className="text-sm text-navy/70">{details(best)}</p>}
        <p className="text-sm text-navy/60">
          {usd(best.price)}
          <Marks c={best} />
        </p>
      </div>
      <ul className="-mx-4 mt-6 flex w-[calc(100%+2rem)] snap-x gap-3 overflow-x-auto px-4 pb-2 text-left" aria-label="The other 11 cards in this pack">
        {rest.map((c, i) => (
          <li key={c.id} id={`card-${c.id}`} className="card-in w-24 shrink-0 snap-start sm:w-28" style={{ "--i": i + 1 } as React.CSSProperties}>
            <TiltCard src={`/api/play/image/${c.id}`} alt={c.name} onTap={() => setOpen(c.id)} pan="pan-x pan-y" />
            <p className="mt-1 truncate text-xs font-semibold text-navy">{c.name}</p>
            <p className="truncate text-[11px] text-navy/60">
              {usd(c.price)}
              <Marks c={c} />
            </p>
          </li>
        ))}
      </ul>
      {big && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-navy/95 p-6 pb-40" onClick={() => setOpen(null)} role="dialog" aria-label={big.name}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <TiltCard src={`/api/play/image/${big.id}`} alt={big.name} free max={BIG_TILT} shine={isShiny(big.variant)} />
          </div>
          <p className="mt-3 font-semibold text-sand">{big.name}</p>
          {details(big) && <p className="text-sm text-sand/70">{details(big)}</p>}
          <p className="text-sm text-sand/70">{usd(big.price)}</p>
          <button className="btn-reveal mt-3 px-4 py-1.5" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
