"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SharkFin } from "@/components/SharkFin";
import { confetti, pop } from "@/lib/client/feel";
import type { PublicPack } from "@/lib/lilStack";

/** A swipe has to cross the pack: start on the left side, reach the right edge. */
const START_ZONE = 0.35;
const OPEN_AT = 0.92;
const KEY_STEP = 0.25;

type Art = { closed?: string; open?: string };

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Same order again would look like nothing happened.
  return a.length > 1 && a.every((x, i) => x === xs[i]) ? [...a.slice(1), a[0]] : a;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Grid columns at the current width (matches grid-cols-2 sm:3 md:4 lg:6 below). */
function useColumns() {
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const qs = [
      ["(min-width: 1024px)", 6],
      ["(min-width: 768px)", 4],
      ["(min-width: 640px)", 3],
    ] as const;
    const read = () => setCols(qs.find(([q]) => window.matchMedia(q).matches)?.[1] ?? 2);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return cols;
}

export function LilStackPack({ packs, art }: { packs: PublicPack[]; art: Art }) {
  const reduced = useReducedMotion();
  const cols = useColumns();
  const [idx, setIdx] = useState(0);
  const [order, setOrder] = useState(() => packs[0]?.cards ?? []);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [nudge, setNudge] = useState(false);
  const [deal, setDeal] = useState(0); // remounts the fan so it animates on every open
  const packRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; left: number; width: number } | null>(null);

  const pack = packs[idx];

  const tearOpen = useCallback(() => {
    if (open) return;
    setProgress(1);
    setOpen(true);
    setDeal((d) => d + 1);
    pop();
    confetti(packRef.current); // no-op under reduced motion
  }, [open]);

  function snapBack() {
    setProgress(0);
    setNudge(true);
    window.setTimeout(() => setNudge(false), 450);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (open || reduced || !packRef.current) return;
    const r = packRef.current.getBoundingClientRect();
    if ((e.clientX - r.left) / r.width > START_ZONE) return snapBack(); // has to start on the left
    drag.current = { id: e.pointerId, left: r.left, width: r.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = Math.max(0, Math.min(1, (e.clientX - d.left) / d.width));
    setProgress(p);
    if (p >= OPEN_AT) {
      drag.current = null;
      tearOpen();
    }
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    snapBack(); // a short drag never opens it
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (open || reduced) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const p = Math.min(1, progress + KEY_STEP);
      setProgress(p);
      if (p >= 1) tearOpen();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setProgress(Math.max(0, progress - KEY_STEP));
    }
  }

  function shuffle() {
    setOpen(false);
    setProgress(0);
    if (packs.length > 1) {
      const next = (idx + 1) % packs.length;
      setIdx(next);
      setOrder(packs[next].cards);
    } else setOrder((o) => shuffled(o));
  }

  if (!pack) {
    return (
      <div className="mx-auto mt-10 flex max-w-xs flex-col items-center gap-4 text-center">
        <div className="w-40 opacity-50">
          <CssPack />
        </div>
        <p className="text-sm text-sand/75">The stack is empty right now. Check back after my next batch.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center">
      <p className="mb-3 text-sm font-semibold text-sand/80">
        {pack.label} · {pack.cards.length} card{pack.cards.length === 1 ? "" : "s"}
        {packs.length > 1 && <span className="text-sand/50"> · pack {idx + 1} of {packs.length}</span>}
      </p>

      <div
        ref={packRef}
        role={reduced ? undefined : "button"}
        tabIndex={open || reduced ? -1 : 0}
        aria-label={open ? `${pack.label}, open` : "Sealed pack. Swipe left to right across it to tear it open, or press the right arrow key four times."}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
        className={`relative select-none outline-none transition-[width] duration-500 focus-visible:ring-4 focus-visible:ring-teal/60 ${
          open ? "w-28 sm:w-32" : "w-52 cursor-grab active:cursor-grabbing sm:w-60"
        } ${nudge ? "ls-nudge" : ""}`}
        style={{ touchAction: "pan-y" }}
      >
        {open ? (
          art.open ? <img src={art.open} alt="" draggable={false} className="w-full rounded-lg" /> : <CssPack torn />
        ) : (
          <>
            {art.closed ? <img src={art.closed} alt="" draggable={false} className="w-full rounded-lg shadow-2xl" /> : <CssPack progress={progress} />}
            {!reduced && <TearGuide progress={progress} />}
          </>
        )}
      </div>

      {!open &&
        (reduced ? (
          <button type="button" data-nopop className="btn-primary mt-5" onClick={tearOpen}>
            Tap to open
          </button>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-sm text-sand/75" aria-hidden>
            Swipe across the pack to tear it open <span className="ls-arrow inline-block text-teal">→</span>
          </p>
        ))}

      {open && (
        <>
          <ul key={deal} className="mt-6 grid w-full max-w-4xl grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-label={`Inside ${pack.label}`}>
            {order.map((c, i) => {
              // Each row is its own little fan: tilt out from the row's middle, outer cards dip.
              const rowStart = i - (i % cols);
              const inRow = Math.min(cols, order.length - rowStart);
              const off = i - rowStart - (inRow - 1) / 2;
              const rot = off * (cols > 3 ? 3 : 4);
              const lift = off ** 2 * (cols > 3 ? 2 : 3);
              return (
                <li
                  key={c.id}
                  className="ls-card"
                  style={{ "--i": i, "--rot": `${rot}deg`, "--lift": `${lift}px` } as React.CSSProperties}
                >
                  <div className="ls-flip relative aspect-[5/7] w-full">
                    <img
                      src={`/api/shop/image/${c.id}/front`}
                      alt={c.name}
                      loading="lazy"
                      draggable={false}
                      className="ls-face absolute inset-0 h-full w-full rounded-lg bg-navy-2 object-cover shadow-xl ring-1 ring-white/10"
                    />
                    <div className="ls-face ls-back absolute inset-0 flex items-center justify-center rounded-lg bg-navy-2 ring-2 ring-teal/40">
                      <SharkFin size={44} />
                    </div>
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-white">{c.name}</p>
                  {c.setName && <p className="truncate text-xs text-sand/60">{c.setName}</p>}
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn-primary mt-8" onClick={shuffle}>
            Shuffle
          </button>
          <p className="mt-2 text-xs text-sand/50">{packs.length > 1 ? "Closes this one and deals the next pack." : "Restacks this pack in a new order."}</p>
        </>
      )}
    </div>
  );
}

/** The dashed tear line along the top, filling teal as the swipe crosses it. */
function TearGuide({ progress }: { progress: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[9%]" aria-hidden>
      <div className="mx-[6%] h-0.5 border-t-2 border-dashed border-sand/50" />
      <div className="absolute left-[6%] top-[-3px] h-2 rounded-full bg-teal shadow-[0_0_12px_#1AA6A6]" style={{ width: `${progress * 88}%` }} />
      <div
        className="absolute top-[-11px] h-6 w-6 rounded-full border-2 border-white bg-teal shadow-lg"
        style={{ left: `calc(${4 + progress * 88}% - 2px)` }}
      />
    </div>
  );
}

/** Drawn pack used when there's no generated art (or no GEMINI_API_KEY). */
function CssPack({ progress = 0, torn = false }: { progress?: number; torn?: boolean }) {
  return (
    <div className={`ls-pack relative aspect-[5/7] w-full ${torn ? "ls-torn" : ""}`}>
      {!torn && (
        <div className="ls-crimp absolute inset-x-0 top-0 h-[7%] origin-left" style={{ transform: `rotate(${-progress * 7}deg) translateY(${-progress * 8}px)` }} />
      )}
      <div className="ls-body absolute inset-x-0 bottom-0 top-[7%] overflow-hidden">
        <div className="absolute inset-x-0 top-[24%] flex justify-center">
          <SharkFin size={torn ? 40 : 84} />
        </div>
        <div className="absolute inset-x-0 top-[58%] bg-sand py-[5%] text-center">
          <span className={`font-extrabold uppercase tracking-[0.25em] text-navy ${torn ? "text-[9px]" : "text-sm"}`}>Lil&apos; Stack</span>
        </div>
        {!torn && <div className="absolute inset-x-0 bottom-[9%] text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-teal">Trade Shark</div>}
        <div className="ls-sheen absolute inset-0" />
      </div>
      <div className="ls-crimp absolute inset-x-0 bottom-0 h-[6%]" />
    </div>
  );
}
