"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { packStill } from "@/lib/brandAssets";
import { confetti, pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import { NUDGES, PRICES, RULES_LINE, TIMER_SECONDS } from "@/lib/game/rules";
import { Stage } from "@/components/Stage";
import { CardGrid } from "./CardGrid";

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
  opensAt: string | null;
  hasCard: boolean;
  cardLabel?: string | null;
  member: boolean;
  stackLeft: boolean;
  lockedUntil: string | null;
  revealing: { cycleId: string; deadline: string; pack: PackView | null } | null;
  serverNow: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
type Res = Record<string, unknown> & { ok: boolean; error?: string; code?: string };
const post = async (path: string, body: unknown): Promise<Res> => {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: r.statusText }))) as Res;
};

export function Game(p: GameProps) {
  // Server clock minus ours, so the timer matches the server's deadline.
  const skew = useRef(new Date(p.serverNow).getTime() - Date.now());
  const [phase, setPhase] = useState<Phase>(() => {
    if (p.revealing?.pack && p.revealing.cycleId)
      return { k: "revealing", cycleId: p.revealing.cycleId, deadline: new Date(p.revealing.deadline).getTime(), pack: p.revealing.pack };
    if (p.lockedUntil && !p.member) return { k: "passed", why: "locked" };
    return { k: "intro" };
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [left, setLeft] = useState(TIMER_SECONDS);
  const [nudge, setNudge] = useState(0);
  const [stackLeft, setStackLeft] = useState(p.stackLeft);
  // After a payment the pack seal splits open (about half a second), then the cards fan out.
  const [seal, setSeal] = useState(false);
  useEffect(() => {
    if (!seal) return;
    const t = window.setTimeout(() => setSeal(false), 520);
    return () => window.clearTimeout(t);
  }, [seal]);
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
    setSeal(true);
    setPhase({ k: "revealing", cycleId: r.cycleId as string, deadline: new Date(r.deadline as string).getTime(), pack: r.pack as PackView });
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
      if (r.code === "expired" || r.code === "closed") setPhase({ k: "passed", why: "timer" });
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
    setSeal(true);
    setPhase({ k: "won", pack: r.pack as PackView, how: "blind" });
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

  // This category's sealed shark pack (public/brand). The only object with a shadow.
  const packArt = (cls = "") => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={packStill(p.category)} alt="" className={`pack-shadow w-full ${cls}`} draggable={false} />
  );
  // The seal split: the crimped top lifts away while the body drops and fades.
  const sealSplit = (
    <Stage category={p.category} className="flex aspect-[4/5] w-full max-w-sm items-center justify-center rounded-lg border-b-2 border-gold">
      <div className="relative w-40 sm:w-48">
        {packArt("seal-body")}
        <div className="absolute inset-0">{packArt("seal-top")}</div>
      </div>
    </Stage>
  );

  const opensAt = p.opensAt ? new Date(p.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center text-center">
      {error && <p className="mb-4 rounded border border-coral/40 bg-white px-3 py-2 text-sm text-navy">{error}</p>}

      {phase.k === "intro" && (
        <>
          {/* The stage sits behind the pack only; the rules and the $1 button stay on cream below. */}
          <Stage category={p.category} className="flex aspect-[4/5] w-full max-w-sm items-center justify-center rounded-lg border-b-2 border-gold p-12">
            <div className="w-40 sm:w-48">{packArt()}</div>
          </Stage>
          <Rules odds={p.odds} />
          {!p.open ? (
            <p className="mt-6 text-sm text-navy/75">
              {opensAt ? (
                <>
                  A new drop opens to everyone at {opensAt}. <Link href="/play/member" className="underline">Members</Link> are in now.
                </>
              ) : (
                <>No {p.product}s are ready right now. Check back after my next batch.</>
              )}
            </p>
          ) : !p.hasCard ? (
            <Link href={`/play/card?next=${p.category}`} className="btn-reveal mt-6 px-7 py-3 text-base">
              Save a card to play
            </Link>
          ) : (
            <>
              <button className="btn-reveal mt-6 px-9 py-3.5 text-lg" disabled={!!busy} onClick={() => reveal()} data-pop>
                {busy === "reveal" ? "Revealing…" : `Reveal for ${usd(PRICES.reveal)}`}
              </button>
              {p.member && stackLeft && (
                <button className="btn-ghost mt-3 px-5 py-2" disabled={!!busy} onClick={() => reveal(true)}>
                  {busy === "stack" ? "Revealing…" : `Reveal my member stack · ${usd(PRICES.reveal)}`}
                </button>
              )}
              <p className="mt-2 text-xs text-navy/55">
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
          {seal ? (
            sealSplit
          ) : (
            <div className="flex items-center gap-4">
              <Stage category={p.category} className="flex items-center justify-center rounded-lg border-b-2 border-gold p-3">
                <div ref={packRef} key={`n${nudge}`} className={`w-16 ${nudge ? "ls-nudge" : ""}`}>
                  {packArt()}
                </div>
              </Stage>
              <Timer left={left} />
            </div>
          )}
          {phase.pack.kind === "member" && <p className="mt-3 text-sm font-semibold text-navy">Member stack: your best card is bumped.</p>}
          <div className="after-seal w-full">
            <CardGrid pack={phase.pack} light />
          </div>
          {/* Stays on screen while you scroll the cards: the clock and both choices. */}
          <div className="sticky bottom-3 z-30 mt-6 flex w-full max-w-md flex-col items-center gap-1.5 rounded-lg border border-navy/15 border-b-2 border-b-gold bg-sand p-3">
            <p className="text-xs text-navy/65">Pack value {usd(phase.pack.value)} · stored in your Collection until you ship</p>
            <p className="text-sm font-semibold text-navy">
              Keep all 12 for {usd(PRICES.keepMore)} more ({usd(PRICES.keepTotal)} in all) · <span className={left <= 10 ? "text-coral" : ""}>{left}s</span>
            </p>
            <div className="flex items-center gap-5">
              <button className="px-2 py-3 text-base font-semibold text-navy/70 underline-offset-4 hover:underline" disabled={!!busy} onClick={() => passNow("pass")} data-nopop>
                Pass
              </button>
              <button ref={keepRef} className="btn-keep px-8 py-3 text-lg" disabled={!!busy} onClick={keepIt} data-pop>
                {busy === "keep" ? "Keeping…" : `Keep · ${usd(PRICES.keepMore)}`}
              </button>
            </div>
          </div>
        </>
      )}

      {phase.k === "passed" && (
        <>
          <Stage category={p.category} className="flex items-center justify-center rounded-lg border-b-2 border-gold p-6">
            <div ref={packRef} className="gone w-32">
              {packArt()}
            </div>
          </Stage>
          <p className="mt-5 text-lg font-bold text-navy">
            {phase.why === "timer" ? "Time's up. That pack is gone." : phase.why === "locked" ? `You passed on a ${p.product} today.` : "That pack is gone."}
          </p>
          <p className="mt-1 max-w-sm text-sm text-navy/75">
            {p.member ? "Members can reveal again right away, or take" : "The only one left for you today is"} a {usd(PRICES.blind)} pack you see after you pay. Same packs, same odds.
          </p>
          <button className="btn-reveal mt-4 px-7 py-3 text-base" disabled={!!busy || !p.open} onClick={buyBlind} data-pop>
            {busy === "blind" ? "Opening…" : `Buy a blind pack · ${usd(PRICES.blind)}`}
          </button>
          {p.member && (
            <button className="btn-ghost mt-3 px-5 py-2" disabled={!!busy} onClick={() => reveal()}>
              Reveal another · {usd(PRICES.reveal)}
            </button>
          )}
          <ul className="mt-6 space-y-0.5 text-xs text-navy/60">
            {p.odds.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </>
      )}

      {phase.k === "won" && (
        <>
          {seal && <div className="mb-4 w-full max-w-sm">{sealSplit}</div>}
          <p className="text-2xl font-extrabold text-navy">{phase.how === "kept" ? "It's yours!" : "Here's your pack!"}</p>
          <p className="mt-1 text-sm text-navy/75">
            {phase.pack.number ? `Pack ${phase.pack.number} is` : "It's"} in your{" "}
            <Link href="/collection" className="underline">
              Collection
            </Link>
            . Ship it whenever you like, on its own or with other packs.
          </p>
          <div className="after-seal w-full">
            <CardGrid pack={phase.pack} light />
          </div>
          <div className="mt-6 flex items-center gap-4">
            <button
              className="btn-reveal px-7 py-3"
              onClick={() => {
                setError("");
                setPhase({ k: "intro" });
              }}
            >
              Play again
            </button>
            <Link href="/collection" className="px-2 py-3 font-semibold text-navy underline-offset-4 hover:underline">
              My collection
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function Rules({ odds }: { odds: string[] }) {
  return (
    <div className="mt-6 max-w-md">
      <p className="text-lg font-semibold leading-snug text-navy">{RULES_LINE}</p>
      <ul className="mt-3 space-y-1 text-left text-sm text-navy/80">
        {odds.map((o) => (
          <li key={o} className="flex gap-2">
            <span className="text-gold">•</span>
            {o}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-left text-xs text-navy/60">Packs you buy wait in your Collection. Ship one or several together whenever you like; shipping is charged then.</p>
    </div>
  );
}

function Timer({ left }: { left: number }) {
  const frac = left / TIMER_SECONDS;
  return (
    <div className="relative h-16 w-16" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(11,31,58,0.12)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={left <= 10 ? "#E85D4C" : "#0B1F3A"} strokeWidth="3" strokeDasharray={`${frac * 97.4} 97.4`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-extrabold text-navy">{left}</span>
    </div>
  );
}
