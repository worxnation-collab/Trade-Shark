"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CssPack } from "@/components/PackArt";
import { confetti, pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import { NUDGES, PRICES, RULES_LINE, TIMER_SECONDS } from "@/lib/game/rules";
import type { ShipLine } from "@/lib/game/ship";
import { TiltCard } from "./TiltCard";

type Phase =
  | { k: "intro" }
  | { k: "revealing"; cycleId: string; deadline: number; pack: PackView; ship: ShipLine | null }
  | { k: "passed"; why: "pass" | "timer" | "left" | "locked" }
  | { k: "won"; pack: PackView; how: "kept" | "blind"; shipping: number };

export interface GameProps {
  category: string;
  product: string;
  odds: string[];
  open: boolean;
  opensAt: string | null;
  hasCard: boolean;
  cardLabel?: string | null;
  member: boolean;
  stackLeft: boolean;
  lockedUntil: string | null;
  revealing: { cycleId: string; deadline: string; pack: PackView | null; ship: ShipLine | null } | null;
  serverNow: string;
  art: { closed?: string; open?: string };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
type Res = Record<string, unknown> & { ok: boolean; error?: string; code?: string; ship?: ShipLine };
const post = async (path: string, body: unknown): Promise<Res> => {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: r.statusText }))) as Res;
};

export function Game(p: GameProps) {
  // Server clock minus ours, so the timer matches the server's deadline.
  const skew = useRef(new Date(p.serverNow).getTime() - Date.now());
  const [phase, setPhase] = useState<Phase>(() => {
    if (p.revealing?.pack && p.revealing.cycleId)
      return { k: "revealing", cycleId: p.revealing.cycleId, deadline: new Date(p.revealing.deadline).getTime(), pack: p.revealing.pack, ship: p.revealing.ship };
    if (p.lockedUntil && !p.member) return { k: "passed", why: "locked" };
    return { k: "intro" };
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [left, setLeft] = useState(TIMER_SECONDS);
  const [nudge, setNudge] = useState(0);
  const [blindShip, setBlindShip] = useState<ShipLine | null>(null);
  const [stackLeft, setStackLeft] = useState(p.stackLeft);
  const packRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const cycleRef = useRef<string | null>(null);
  cycleRef.current = phase.k === "revealing" ? phase.cycleId : null;

  async function reveal(memberStack = false) {
    setBusy(memberStack ? "stack" : "reveal");
    setError("");
    const r = await post("/api/play/reveal", { category: p.category, memberStack });
    setBusy("");
    if (!r.ok) {
      if (r.code === "locked") setPhase({ k: "passed", why: "locked" });
      if (r.code === "no-card") window.location.href = `/play/card?next=${p.category}`;
      return setError(r.error ?? "That didn't work.");
    }
    if (memberStack) setStackLeft(false);
    skew.current = new Date(r.serverNow as string).getTime() - Date.now();
    pop();
    setPhase({ k: "revealing", cycleId: r.cycleId as string, deadline: new Date(r.deadline as string).getTime(), pack: r.pack as PackView, ship: r.ship ?? null });
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
      if (r.code === "ship-changed" && r.ship) setPhase({ ...phase, ship: r.ship });
      if (r.code === "expired" || r.code === "closed") setPhase({ k: "passed", why: "timer" });
      return setError(r.error ?? "That didn't work.");
    }
    cycleRef.current = null;
    confetti(keepRef.current);
    setPhase({ k: "won", pack: r.pack as PackView, how: "kept", shipping: (r.shipping as number) ?? 0 });
  }

  // The blind button shows its one shipping line before anyone pays.
  useEffect(() => {
    if (phase.k !== "passed" || blindShip) return;
    void post("/api/play/ship-quote", {}).then((r) => r.ok && r.ship && setBlindShip(r.ship));
  }, [phase.k, blindShip]);

  async function buyBlind() {
    setBusy("blind");
    setError("");
    const r = await post("/api/play/blind", { category: p.category, quoteId: blindShip?.quoteId });
    setBusy("");
    if (!r.ok) {
      if (r.code === "ship-changed" && r.ship) setBlindShip(r.ship);
      return setError(r.error ?? "That didn't work.");
    }
    setBlindShip(null);
    confetti(packRef.current);
    setPhase({ k: "won", pack: r.pack as PackView, how: "blind", shipping: (r.shipping as number) ?? 0 });
  }

  // The 30 s clock, the two nudges, and expiry. Expiry only removes the choice; it never charges.
  useEffect(() => {
    if (phase.k !== "revealing") return;
    const fired = new Set<number>();
    const tick = () => {
      const ms = phase.deadline - (Date.now() + skew.current);
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
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
      <img src={torn ? p.art.open : p.art.closed} alt="" className="w-full rounded-lg shadow-2xl" draggable={false} />
    ) : (
      <CssPack torn={torn} />
    );

  const opensAt = p.opensAt ? new Date(p.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const keepTotal = phase.k === "revealing" ? PRICES.keepMore + (phase.ship?.amount ?? 0) : 0;
  const blindTotal = PRICES.blind + (blindShip?.amount ?? 0);

  return (
    <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center text-center">
      {error && <p className="mb-4 rounded bg-coral/20 px-3 py-2 text-sm text-white">{error}</p>}

      {phase.k === "intro" && (
        <>
          <div className="w-44 sm:w-52">{packArt()}</div>
          <Rules odds={p.odds} />
          {!p.open ? (
            <p className="mt-6 text-sm text-sand/75">
              {opensAt ? (
                <>
                  A new drop opens to everyone at {opensAt}. <Link href="/play/member" className="underline">Members</Link> are in now.
                </>
              ) : (
                <>No {p.product}s are ready right now. Check back after my next batch.</>
              )}
            </p>
          ) : !p.hasCard ? (
            <Link href={`/play/card?next=${p.category}`} className="btn-coral mt-6 px-7 py-3 text-base">
              Save a card to play
            </Link>
          ) : (
            <>
              <button className="btn-coral mt-6 px-8 py-3 text-lg" disabled={!!busy} onClick={() => reveal()} data-pop>
                {busy === "reveal" ? "Revealing…" : `Reveal for ${usd(PRICES.reveal)}`}
              </button>
              {p.member && stackLeft && (
                <button className="btn-ghost mt-3 px-5 py-2" disabled={!!busy} onClick={() => reveal(true)}>
                  {busy === "stack" ? "Revealing…" : `Reveal my member stack · ${usd(PRICES.reveal)}`}
                </button>
              )}
              <p className="mt-2 text-xs text-sand/50">
                Charged to {p.cardLabel ?? "your saved card"}.{" "}
                <Link href={`/play/card?next=${p.category}`} className="underline">
                  Change
                </Link>
                {" · "}
                <Link href="/play/member" className="underline">
                  {p.member ? "Membership" : "Membership $7.99/mo"}
                </Link>
              </p>
            </>
          )}
        </>
      )}

      {phase.k === "revealing" && (
        <>
          <div className="flex items-center gap-4">
            <div ref={packRef} key={`n${nudge}`} className={`w-16 ${nudge ? "ls-nudge" : ""}`}>
              {packArt(true)}
            </div>
            <Timer left={left} />
          </div>
          {phase.pack.kind === "member" && <p className="mt-3 text-sm font-semibold text-teal">Member stack: your best card is bumped.</p>}
          <CardGrid pack={phase.pack} />
          {/* Stays on screen while you scroll the cards: the clock, the one shipping line and both choices. */}
          <div className="sticky bottom-3 z-30 mt-6 flex w-full max-w-md flex-col items-center gap-1.5 rounded-2xl bg-navy-2/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <p className="text-xs text-sand/75">Shipping · {phase.ship?.label ?? "…"}</p>
            <p className="text-sm font-semibold text-white">
              Keep all 12: {usd(PRICES.keepMore)} + {usd(phase.ship?.amount ?? 0)} shipping = {usd(keepTotal)} ·{" "}
              <span className={left <= 10 ? "text-coral" : "text-teal"}>{left}s</span>
            </p>
            <div className="flex gap-3">
              <button className="btn-ghost px-5 py-3" disabled={!!busy} onClick={() => passNow("pass")} data-nopop>
                Pass
              </button>
              <button ref={keepRef} key={`k${nudge}`} className={`btn-coral px-8 py-3 text-lg ${nudge ? "keep-pulse" : ""}`} disabled={!!busy || !phase.ship} onClick={keepIt} data-pop>
                {busy === "keep" ? "Keeping…" : `Keep · ${usd(keepTotal)}`}
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
            {phase.why === "timer" ? "Time's up. That pack is gone." : phase.why === "locked" ? `You passed on a ${p.product} today.` : "That pack is gone."}
          </p>
          <p className="mt-1 max-w-sm text-sm text-sand/75">
            {p.member ? "Members can reveal again right away, or take" : "The only one left for you today is"} a {usd(PRICES.blind)} pack you see after you pay. Same packs, same odds.
          </p>
          <p className="mt-3 text-xs text-sand/70">Shipping · {blindShip?.label ?? "…"}</p>
          <button className="btn-coral mt-2 px-7 py-3 text-base" disabled={!!busy || !p.open || !blindShip} onClick={buyBlind} data-pop>
            {busy === "blind" ? "Opening…" : `Buy a blind pack · ${usd(blindTotal)}`}
          </button>
          {p.member && (
            <button className="btn-ghost mt-3 px-5 py-2" disabled={!!busy} onClick={() => reveal()}>
              Reveal another · {usd(PRICES.reveal)}
            </button>
          )}
          <ul className="mt-6 space-y-0.5 text-xs text-sand/60">
            {p.odds.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </>
      )}

      {phase.k === "won" && (
        <>
          <p className="text-2xl font-extrabold text-white">{phase.how === "kept" ? "It's yours!" : "Here's your pack!"}</p>
          <p className="mt-1 text-sm text-sand/75">
            {phase.pack.number ? `Pack ${phase.pack.number}. ` : ""}All 12 cards ship from Florida by USPS Ground Advantage. Tracking comes by email.
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
      <p className="mt-2 text-left text-xs text-sand/60">Shipping is one line, USPS Ground Advantage, added when you keep or buy.</p>
    </div>
  );
}

function Timer({ left }: { left: number }) {
  const frac = left / TIMER_SECONDS;
  return (
    <div className="relative h-16 w-16" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(244,239,230,0.15)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={left <= 10 ? "#E85D4C" : "#1AA6A6"} strokeWidth="3" strokeDasharray={`${frac * 97.4} 97.4`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-extrabold text-white">{left}</span>
    </div>
  );
}

/** The 12 real scans. Drag to tilt; tap to open one larger (it tilts there too). */
function CardGrid({ pack }: { pack: PackView }) {
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
          <li key={c.id} className="card-in" style={{ "--i": i } as React.CSSProperties}>
            <TiltCard src={`/api/play/image/${c.id}`} alt={c.name} onTap={() => setOpen(c.id)} />
            <p className="-mt-1 truncate text-xs font-semibold text-white">{c.name}</p>
            <p className="truncate text-[11px] text-sand/60">
              {usd(c.price)}
              {c.chase && <span className="ml-1 font-bold text-coral">CHASE</span>}
              {c.hit && <span className="ml-1 font-bold text-teal">HIT</span>}
              {c.bumped && <span className="ml-1 font-bold text-teal">MEMBER</span>}
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
