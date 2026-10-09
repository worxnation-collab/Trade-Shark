"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CaseCard } from "@/lib/caseStock";

const usd = (n: number) => `$${n.toFixed(2)}`;
/** Drift speed in px per second: slow enough to read a name. */
const SPEED = 16;

function columnsFor(width: number) {
  return width < 640 ? 2 : width < 1024 ? 3 : width < 1400 ? 4 : 5;
}

/**
 * Columns of real card scans drifting slowly down and looping. Tap a card: the reel pauses and the card opens with its
 * name, set and price. Close returns to the reel. Nothing here is for sale and nothing says which pack a card is in.
 */
export function CaseReel({ cards }: { cards: CaseCard[] }) {
  const [cols, setCols] = useState(2);
  const [open, setOpen] = useState<CaseCard | null>(null);
  useLayoutEffect(() => {
    const set = () => setCols(columnsFor(window.innerWidth));
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const columns: CaseCard[][] = Array.from({ length: cols }, () => []);
  cards.forEach((c, i) => columns[i % cols].push(c));

  return (
    <>
      <div className="case-reel grid gap-2 overflow-hidden px-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, height: "calc(100vh - 9rem)" }} data-paused={open ? "" : undefined}>
        {columns.map((list, i) => (
          <Column key={`${cols}-${i}`} list={list} offset={i} onPick={setOpen} />
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-sand/95 p-4" role="dialog" aria-label={open.name} onClick={() => setOpen(null)}>
          <div className="flex max-h-full w-full max-w-sm flex-col items-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/case/image/${open.id}`} alt={open.name} className="max-h-[62vh] w-auto rounded-lg" />
            <p className="mt-4 text-center text-xl font-extrabold text-navy">{open.name}</p>
            {open.set && <p className="text-center text-sm text-navy/70">{open.set}</p>}
            <p className="mt-1 text-center text-lg font-bold text-navy">{usd(open.price)}</p>
            <button className="mt-5 rounded-lg border border-navy/30 bg-white px-6 py-2.5 font-semibold text-navy" onClick={() => setOpen(null)} autoFocus>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** One column: the list twice, drifting down by exactly one copy's height, so the loop has no seam. */
function Column({ list, offset, onPick }: { list: CaseCard[]; offset: number; onPick: (c: CaseCard) => void }) {
  const inner = useRef<HTMLDivElement>(null);
  const [secs, setSecs] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setSecs(Math.max(30, (inner.current?.scrollHeight ?? 0) / 2 / SPEED));
    measure();
    const ro = new ResizeObserver(measure);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [list]);
  const tile = (c: CaseCard, k: string) => (
    <button key={k} className={`block w-full overflow-hidden rounded-md text-left ${k.startsWith("b") ? "case-dup" : ""}`} aria-hidden={k.startsWith("b") || undefined} tabIndex={k.startsWith("b") ? -1 : undefined} onClick={() => onPick(c)} aria-label={`${c.name}, ${usd(c.price)}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/case/image/${c.id}`} alt="" loading="lazy" className="aspect-[5/7] w-full object-contain" />
      <span className="block truncate px-0.5 pt-0.5 text-xs font-semibold text-navy">{c.name}</span>
    </button>
  );
  return (
    <div className="relative h-full overflow-hidden">
      <div ref={inner} className="case-col flex flex-col gap-2" style={{ animationDuration: secs ? `${secs}s` : undefined, animationDelay: `-${offset * 7}s` }}>
        {list.map((c) => tile(c, `a${c.id}`))}
        {list.map((c) => tile(c, `b${c.id}`))}
      </div>
    </div>
  );
}
