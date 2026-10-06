"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandClip } from "@/components/BrandClip";
import { HIT_CLIP, openStill, packStill, passClip, tearClip } from "@/lib/brandAssets";
import { confetti, pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import { NUDGES, PRICES, RULES_LINE, TIMER_SECONDS } from "@/lib/game/rules";
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
  // Brand clips: the tear on a reveal (and a blind buy), the puff on a pass, the sparkle over a hit pack.
  const [clip, setClip] = useState<"tear" | "pass" | null>(null);
  const [hitFx, setHitFx] = useState<"pending" | "play" | null>(null);
  const special = (pk: PackView) => pk.kind === "hit" || pk.kind === "chase" || pk.cards.some((c) => c.hit || c.chase);
  useEffect(() => {
    if (clip === null && hitFx === "pending") setHitFx("play");
  }, [clip, hitFx]);
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
    setClip("tear");
    setHitFx(special(r.pack as PackView) ? "pending" : null);
    setPhase({ k: "revealing", cycleId: r.cycleId as string, deadline: new Date(r.deadline as string).getTime(), pack: r.pack as PackView });
  }

  const passNow = useCallback(async (why: "pass" | "timer") => {
    const id = cycleRef.current;
    if (!id) return;
    cycleRef.current = null;
    setHitFx(null);
    setClip("pass");
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
    setClip("tear");
    setHitFx(special(r.pack as PackView) ? "pending" : null);
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
      setClip("pass");
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

  // This category's pack, drawn with Gemini (public/brand).
  const packArt = (torn = false) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={torn ? openStill(p.category) : packStill(p.category)} alt="" className="clip-soft w-full" draggable={false} />
  );
  // The hit sparkle bursts from the hit (or chase) card itself.
  const cardsWithFx = (pack: PackView) => (
    <CardGrid
      pack={pack}
      fx={hitFx === "play" ? (pack.cards.find((c) => c.chase || c.hit)?.id ?? null) : null}
      fxEl={
        <div className="pointer-events-none absolute left-1/2 top-[38%] z-10 w-[230%] -translate-x-1/2 -translate-y-1/2">
          <BrandClip src={HIT_CLIP} blend onDone={() => setHitFx(null)} className="hit-fx block w-full" />
        </div>
      }
    />
  );

  const opensAt = p.opensAt ? new Date(p.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

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
            {clip === "tear" ? (
              <BrandClip src={tearClip(p.category)} poster={packStill(p.category)} onDone={() => setClip(null)} className="clip-soft w-40 sm:w-48" />
            ) : (
              <div ref={packRef} key={`n${nudge}`} className={`w-16 ${nudge ? "ls-nudge" : ""}`}>
                {packArt(true)}
              </div>
            )}
            <Timer left={left} />
          </div>
          {phase.pack.kind === "member" && <p className="mt-3 text-sm font-semibold text-teal">Member stack: your best card is bumped.</p>}
          {cardsWithFx(phase.pack)}
          {/* Stays on screen while you scroll the cards: the clock and both choices. */}
          <div className="sticky bottom-3 z-30 mt-6 flex w-full max-w-md flex-col items-center gap-1.5 rounded-2xl bg-navy-2/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <p className="text-xs text-sand/75">Pack value {usd(phase.pack.value)} · stored in your Collection until you ship</p>
            <p className="text-sm font-semibold text-white">
              Keep all 12 for {usd(PRICES.keepMore)} more ({usd(PRICES.keepTotal)} in all) ·{" "}
              <span className={left <= 10 ? "text-coral" : "text-teal"}>{left}s</span>
            </p>
            <div className="flex gap-3">
              <button className="btn-ghost px-5 py-3" disabled={!!busy} onClick={() => passNow("pass")} data-nopop>
                Pass
              </button>
              <button ref={keepRef} key={`k${nudge}`} className={`btn-coral px-8 py-3 text-lg ${nudge ? "keep-pulse" : ""}`} disabled={!!busy} onClick={keepIt} data-pop>
                {busy === "keep" ? "Keeping…" : `Keep · ${usd(PRICES.keepMore)}`}
              </button>
            </div>
          </div>
        </>
      )}

      {phase.k === "passed" && (
        <>
          <div ref={packRef} className="w-40">
            {clip === "pass" ? <BrandClip src={passClip(p.category)} poster={packStill(p.category)} onDone={() => setClip(null)} className="clip-soft w-full" /> : <div className="gone">{packArt()}</div>}
          </div>
          <p className="mt-5 text-lg font-bold text-white">
            {phase.why === "timer" ? "Time's up. That pack is gone." : phase.why === "locked" ? `You passed on a ${p.product} today.` : "That pack is gone."}
          </p>
          <p className="mt-1 max-w-sm text-sm text-sand/75">
            {p.member ? "Members can reveal again right away, or take" : "The only one left for you today is"} a {usd(PRICES.blind)} pack you see after you pay. Same packs, same odds.
          </p>
          <button className="btn-coral mt-4 px-7 py-3 text-base" disabled={!!busy || !p.open} onClick={buyBlind} data-pop>
            {busy === "blind" ? "Opening…" : `Buy a blind pack · ${usd(PRICES.blind)}`}
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
          {clip === "tear" && <BrandClip src={tearClip(p.category)} poster={packStill(p.category)} onDone={() => setClip(null)} className="clip-soft mb-2 w-40 sm:w-48" />}
          <p className="text-2xl font-extrabold text-white">{phase.how === "kept" ? "It's yours!" : "Here's your pack!"}</p>
          <p className="mt-1 text-sm text-sand/75">
            {phase.pack.number ? `Pack ${phase.pack.number} is` : "It's"} in your{" "}
            <Link href="/collection" className="underline">
              Collection
            </Link>
            . Ship it whenever you like, on its own or with other packs.
          </p>
          {cardsWithFx(phase.pack)}
          <div className="mt-6 flex gap-3">
            <button
              className="btn-coral px-7 py-3"
              onClick={() => {
                setError("");
                setPhase({ k: "intro" });
              }}
            >
              Play again
            </button>
            <Link href="/collection" className="btn-ghost px-5 py-3">
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
      <p className="text-base font-semibold text-white">{RULES_LINE}</p>
      <ul className="mt-3 space-y-1 text-left text-sm text-sand/80">
        {odds.map((o) => (
          <li key={o} className="flex gap-2">
            <span className="text-teal">•</span>
            {o}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-left text-xs text-sand/60">Packs you buy wait in your Collection. Ship one or several together whenever you like; shipping is charged then.</p>
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
