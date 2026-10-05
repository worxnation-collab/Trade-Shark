"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CssPack } from "@/components/PackArt";
import { SharkFin } from "@/components/SharkFin";
import { confetti, pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import { NUDGES, PRICES, RULES_LINE, TIMER_SECONDS } from "@/lib/game/rules";

type Phase =
  | { k: "intro" }
  | { k: "revealing"; cycleId: string; deadline: number; pack: PackView }
  | { k: "passed"; why: "pass" | "timer" | "left" | "locked" }
  | { k: "won"; pack: PackView; how: "kept" | "blind" };

export interface GameProps {
  category: string;
  product: string;
  odds: string[];
  open: boolean;
  hasCard: boolean;
  cardLabel?: string | null;
  lockedUntil: string | null;
  revealing: {
    cycleId: string;
    deadline: string;
    pack: PackView | null;
  } | null;
  serverNow: string;
  art: { closed?: string; open?: string };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const post = async (path: string, body: unknown) => {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r
    .json()
    .catch(() => ({ ok: false, error: r.statusText }))) as Record<
    string,
    unknown
  > & { ok: boolean; error?: string; code?: string };
};

export function Game(p: GameProps) {
  // Server clock minus ours, so the timer matches the server's deadline.
  const skew = useRef(new Date(p.serverNow).getTime() - Date.now());
  const [phase, setPhase] = useState<Phase>(() => {
    if (p.revealing?.pack && p.revealing.cycleId)
      return {
        k: "revealing",
        cycleId: p.revealing.cycleId,
        deadline: new Date(p.revealing.deadline).getTime(),
        pack: p.revealing.pack,
      };
    if (p.lockedUntil) return { k: "passed", why: "locked" };
    return { k: "intro" };
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [left, setLeft] = useState(TIMER_SECONDS);
  const [nudge, setNudge] = useState(0);
  const packRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const cycleRef = useRef<string | null>(null);
  cycleRef.current = phase.k === "revealing" ? phase.cycleId : null;

  async function reveal() {
    setBusy("reveal");
    setError("");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await post("/api/play/reveal", { category: p.category, tz });
    setBusy("");
    if (!r.ok) {
      if (r.code === "locked") setPhase({ k: "passed", why: "locked" });
      if (r.code === "no-card")
        window.location.href = `/play/card?next=${p.category}`;
      return setError(r.error ?? "That didn't work.");
    }
    skew.current = new Date(r.serverNow as string).getTime() - Date.now();
    pop();
    setPhase({
      k: "revealing",
      cycleId: r.cycleId as string,
      deadline: new Date(r.deadline as string).getTime(),
      pack: r.pack as PackView,
    });
  }

  const passNow = useCallback(async (why: "pass" | "timer") => {
    const id = cycleRef.current;
    if (!id) return;
    cycleRef.current = null;
    setPhase({ k: "passed", why });
    await post("/api/play/pass", { cycleId: id });
  }, []);

  async function keepIt() {
    if (phase.k !== "revealing") return;
    setBusy("keep");
    setError("");
    const r = await post("/api/play/keep", { cycleId: phase.cycleId });
    setBusy("");
    if (!r.ok) {
      if (r.code === "expired" || r.code === "closed")
        setPhase({ k: "passed", why: "timer" });
      return setError(r.error ?? "That didn't work.");
    }
    cycleRef.current = null;
    confetti(keepRef.current);
    setPhase({ k: "won", pack: r.pack as PackView, how: "kept" });
  }

  async function buyBlind() {
    setBusy("blind");
    setError("");
    const r = await post("/api/play/blind", { category: p.category });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "That didn't work.");
    confetti(packRef.current);
    setPhase({ k: "won", pack: r.pack as PackView, how: "blind" });
  }

  // The 30 s clock, the two nudges, and expiry. Expiry only removes the choice; it never charges.
  useEffect(() => {
    if (phase.k !== "revealing") return;
    const fired = new Set<number>();
    const tick = () => {
      const ms = phase.deadline - (Date.now() + skew.current);
      const secs = Math.max(0, Math.ceil(ms / 1000));
      setLeft(secs);
      const elapsed = TIMER_SECONDS - ms / 1000;
      for (const at of NUDGES)
        if (elapsed >= at && !fired.has(at)) {
          fired.add(at);
          setNudge((n) => n + 1);
        }
      if (ms <= 0) void passNow("timer");
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [phase, passNow]);

  // Leaving the screen passes the pack (sendBeacon survives the page going away).
  useEffect(() => {
    if (phase.k !== "revealing") return;
    const leave = () => {
      const id = cycleRef.current;
      if (!id) return;
      cycleRef.current = null;
      navigator.sendBeacon?.("/api/play/pass", JSON.stringify({ cycleId: id }));
      setPhase({ k: "passed", why: "left" });
    };
    const vis = () => document.visibilityState === "hidden" && leave();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", leave);
    };
  }, [phase.k]);

  const packArt = (torn = false) =>
    (torn ? p.art.open : p.art.closed) ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={torn ? p.art.open : p.art.closed}
        alt=""
        className="w-full rounded-lg shadow-2xl"
        draggable={false}
      />
    ) : (
      <CssPack torn={torn} />
    );

  return (
    <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center text-center">
      {error && (
        <p className="mb-4 rounded bg-coral/20 px-3 py-2 text-sm text-white">
          {error}
        </p>
      )}

      {phase.k === "intro" && (
        <>
          <div className="w-44 sm:w-52">{packArt()}</div>
          <Rules odds={p.odds} />
          {!p.open ? (
            <p className="mt-6 text-sm text-sand/75">
              No {p.product}s are ready right now. Check back after my next
              batch.
            </p>
          ) : !p.hasCard ? (
            <Link
              href={`/play/card?next=${p.category}`}
              className="btn-coral mt-6 px-7 py-3 text-base"
            >
              Save a card to play
            </Link>
          ) : (
            <>
              <button
                className="btn-coral mt-6 px-8 py-3 text-lg"
                disabled={!!busy}
                onClick={reveal}
                data-pop
              >
                {busy ? "Revealing…" : `Reveal for ${usd(PRICES.reveal)}`}
              </button>
              <p className="mt-2 text-xs text-sand/50">
                Charged to {p.cardLabel ?? "your saved card"}.{" "}
                <Link
                  href={`/play/card?next=${p.category}`}
                  className="underline"
                >
                  Change
                </Link>
              </p>
            </>
          )}
        </>
      )}

      {phase.k === "revealing" && (
        <>
          <div className="flex items-center gap-4">
            <div
              ref={packRef}
              key={`n${nudge}`}
              className={`w-16 ${nudge ? "ls-nudge" : ""}`}
            >
              {packArt(true)}
            </div>
            <Timer left={left} />
          </div>
          <CardGrid pack={phase.pack} />
          {/* Stays on screen while you scroll the cards: the clock and both choices are always in reach. */}
          <div className="sticky bottom-3 z-10 mt-6 flex w-full max-w-md flex-col items-center gap-2 rounded-2xl bg-navy-2/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <p className="text-sm font-semibold text-white">
              Keep all 12 for {usd(PRICES.keepMore)} more (
              {usd(PRICES.keepTotal)} with your reveal) ·{" "}
              <span className={left <= 10 ? "text-coral" : "text-teal"}>
                {left}s
              </span>
            </p>
            <div className="flex gap-3">
              <button
                className="btn-ghost px-5 py-3"
                disabled={!!busy}
                onClick={() => passNow("pass")}
                data-nopop
              >
                Pass
              </button>
              <button
                ref={keepRef}
                key={`k${nudge}`}
                className={`btn-coral px-8 py-3 text-lg ${nudge ? "keep-pulse" : ""}`}
                disabled={!!busy}
                onClick={keepIt}
                data-pop
              >
                {busy === "keep"
                  ? "Keeping…"
                  : `Keep · ${usd(PRICES.keepMore)}`}
              </button>
            </div>
          </div>
        </>
      )}

      {phase.k === "passed" && (
        <>
          <div ref={packRef} className="w-40 opacity-90">
            {packArt()}
          </div>
          <p className="mt-5 text-lg font-bold text-white">
            {phase.why === "timer"
              ? "Time's up. That pack is gone."
              : phase.why === "locked"
                ? `You passed on a ${p.product} today.`
                : "That pack is gone."}
          </p>
          <p className="mt-1 max-w-sm text-sm text-sand/75">
            The only one left for you today is a {usd(PRICES.blind)} pack you
            see after you pay. Same packs, same odds.
          </p>
          <button
            className="btn-coral mt-5 px-7 py-3 text-base"
            disabled={!!busy || !p.open}
            onClick={buyBlind}
            data-pop
          >
            {busy === "blind"
              ? "Opening…"
              : `Buy a blind pack · ${usd(PRICES.blind)}`}
          </button>
          <ul className="mt-6 space-y-0.5 text-xs text-sand/60">
            {p.odds.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </>
      )}

      {phase.k === "won" && (
        <>
          <p className="text-2xl font-extrabold text-white">
            {phase.how === "kept" ? "It's yours!" : "Here's your pack!"}
          </p>
          <p className="mt-1 text-sm text-sand/75">
            All 12 cards ship to you from Florida. A receipt is on its way from
            Stripe.
          </p>
          <CardGrid pack={phase.pack} />
          <button
            className="btn-coral mt-6 px-7 py-3"
            onClick={() => {
              setError("");
              setPhase({ k: "intro" });
            }}
          >
            Play again
          </button>
        </>
      )}
    </div>
  );
}

function Rules({ odds }: { odds: string[] }) {
  return (
    <div className="mt-6 max-w-md">
      <p className="text-base font-semibold text-white">{RULES_LINE}</p>
      <ul className="mt-3 space-y-1 text-left text-sm text-sand/80">
        {odds.map((o) => (
          <li key={o} className="flex gap-2">
            <span className="text-teal">•</span>
            {o}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timer({ left }: { left: number }) {
  const frac = left / TIMER_SECONDS;
  return (
    <div
      className="relative h-16 w-16"
      role="timer"
      aria-live="off"
      aria-label={`${left} seconds left`}
    >
      <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="rgba(244,239,230,0.15)"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={left <= 10 ? "#E85D4C" : "#1AA6A6"}
          strokeWidth="3"
          strokeDasharray={`${frac * 97.4} 97.4`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-extrabold text-white">
        {left}
      </span>
    </div>
  );
}

function CardGrid({ pack }: { pack: PackView }) {
  return (
    <ul
      className="mt-6 grid w-full grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-6"
      aria-label="The 12 cards in this pack"
    >
      {pack.cards.map((c, i) => (
        <li
          key={c.id}
          className="ls-card"
          style={
            {
              "--i": i,
              "--rot": "0deg",
              "--lift": "0px",
            } as React.CSSProperties
          }
        >
          <div className="ls-flip relative aspect-[5/7] w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/play/image/${c.id}`}
              alt={c.name}
              draggable={false}
              className="ls-face absolute inset-0 h-full w-full rounded-lg bg-navy-2 object-cover shadow-xl ring-1 ring-white/10"
            />
            <div className="ls-face ls-back absolute inset-0 flex items-center justify-center rounded-lg bg-navy-2 ring-2 ring-teal/40">
              <SharkFin size={36} />
            </div>
          </div>
          <p className="mt-1.5 truncate text-xs font-semibold text-white">
            {c.name}
          </p>
          <p className="truncate text-[11px] text-sand/60">
            {usd(c.price)}
            {c.chase && (
              <span className="ml-1 font-bold text-coral">CHASE</span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
