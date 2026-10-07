"use client";

import { useEffect, useState } from "react";
import type { PackView } from "@/lib/game/packs";
import { TiltCard } from "./TiltCard";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The 12 real scans. Drag to tilt; tap to open one larger (it tilts there too). */
export function CardGrid({ pack, light = false }: { pack: PackView; light?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const big = pack.cards.find((c) => c.id === open);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <ul className="mt-6 grid w-full grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 lg:grid-cols-6" aria-label="The 12 cards in this pack">
        {pack.cards.map((c, i) => (
          <li key={c.id} id={`card-${c.id}`} className="card-in relative" style={{ "--i": i } as React.CSSProperties}>
            <TiltCard src={`/api/play/image/${c.id}`} alt={c.name} onTap={() => setOpen(c.id)} />
            <p className={`-mt-1 truncate text-xs font-semibold ${light ? "text-navy" : "text-white"}`}>{c.name}</p>
            <p className={`truncate text-[11px] ${light ? "text-navy/60" : "text-sand/60"}`}>
              {usd(c.price)}
              {c.chase && <span className="ml-1 font-bold text-coral">CHASE</span>}
              {c.hit && <span className="ml-1 font-bold text-navy">HIT</span>}
              {c.bumped && <span className="ml-1 font-bold text-navy">MEMBER</span>}
            </p>
          </li>
        ))}
      </ul>
      {big && (
        <div className="fixed inset-0 z-20 flex flex-col items-center justify-center bg-navy/90 p-6 pb-40 backdrop-blur-sm" onClick={() => setOpen(null)} role="dialog" aria-label={big.name}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <TiltCard src={`/api/play/image/${big.id}`} alt={big.name} free />
          </div>
          <p className="mt-2 font-semibold text-white">{big.name}</p>
          <p className="text-sm text-sand/70">
            {big.setName ? `${big.setName} · ` : ""}
            {usd(big.price)}
          </p>
          <button className="btn-ghost mt-3 px-4 py-1.5" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
