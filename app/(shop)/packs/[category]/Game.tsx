"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { pop } from "@/lib/client/feel";
import type { PackView } from "@/lib/game/packs";
import { LOOKS_PER_DAY, PRICES, RULES_LINE, TIMER_SECONDS } from "@/lib/game/rules";
import { Pack } from "@/components/Pack";
import { Stage } from "@/components/Stage";
import { CardGrid } from "./CardGrid";

type Phase =
  | { k: "intro" }
  | { k: "revealing"; cycleId: string; deadline: number; pack: PackView }
  | { k: "passed"; why: "pass" | "timer" }
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
  looksLeft: number;
  revealing: { cycleId: string; deadline: string; pack: PackView | null } | null;
  serverNow: string;
  error?: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
type Res = Record<string, unknown> & { ok: boolean; error?: string; code?: string };
const post = async (path: string, body: unknown): Promise<Res> => {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: r.statusText }))) as Res;
};

export function Game(p: GameProps) {
  // Server clock minus ours, so the timer matches the server's deadline.
  const skew = useRef(new Date(p.serverNow).getTime() - Date.now());
  const [phase, setPhase] = useState<Phase>(() =>
    p.revealing?.pack && p.revealing.cycleId
      ? { k: "revealing", cycleId: p.revealing.cycleId, deadline: new Date(p.revealing.deadline).getTime(), pack: p.revealing.pack }
      : { k: "intro" },
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(p.error ?? "");
  const [left, setLeft] = useState(TIMER_SECONDS);
  const [looks, setLooks] = useState(p.looksLeft);
  const [stackLeft, setStackLeft] = useState(p.stackLeft);
  // The cards fan out when a pack opens (after a blind buy, the seal splits first).
  const [seal, setSeal] = useState(false);
  useEffect(() => {
    if (!seal) return;
    const t = window.setTimeout(() => setSeal(false), 520);
    return () => window.clearTimeout(t);
  }, [seal]);
  const cycleRef = useRef<string | null>(null);
  cycleRef.current = phase.k === "revealing" ? phase.cycleId : null;

  async function look(memberStack = false) {
    setBusy(memberStack ? "stack" : "look");
    setError("");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await post("/api/play/look", { category: p.category, memberStack, tz });
    setBusy("");
    if (!r.ok) {
      if (r.code === "no-looks") setLooks(0);
      return setError(r.error ?? "That didn't work.");
    }
    if (memberStack) setStackLeft(false);
    setLooks((n) => Math.max(0, n - 1));
    skew.current = new Date(r.serverNow as string).getTime() - Date.now();
    pop();
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
    if (r.ok && r.checkoutUrl) {
      // No saved card yet: Stripe Checkout takes the $3.99 and saves the card. The pack is held meanwhile.
      window.location.href = r.checkoutUrl as string;
      return;
    }
    setBusy("");
    if (!r.ok) {
      if (r.code === "expired" || r.code === "closed") setPhase({ k: "passed", why: "timer" });
      return setError(r.error ?? "That didn't work.");
    }
    cycleRef.current = null;
    setPhase({ k: "won", pack: r.pack as PackView, how: "kept" });
  }

  async function buyBlind() {
    setBusy("blind");
    setError("");
    const r = await post("/api/play/blind", { category: p.category });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "That didn't work.");
    setSeal(true);
    setPhase({ k: "won", pack: r.pack as PackView, how: "blind" });
  }

  // The 120 s clock. Running out only puts the cards back; it never charges. Leaving the page doesn't pass.
  useEffect(() => {
    if (phase.k !== "revealing") return;
    const tick = () => {
      const ms = phase.deadline - (Date.now() + skew.current);
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0) void passNow("timer");
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [phase, passNow]);

  // The pack drawn from the fin (components/Pack.tsx). The only object with a shadow.
  const packArt = (cls = "") => <Pack category={p.category} className={cls} />;
  // The seal split after a blind buy: the crimped top lifts away while the body drops and fades.
  const sealSplit = (
    <Stage category={p.category} className="flex aspect-[4/5] w-full max-w-sm items-center justify-center rounded-lg">
      <div className="relative w-40 sm:w-48">
        {packArt("seal-body")}
        <div className="absolute inset-0">{packArt("seal-top")}</div>
      </div>
    </Stage>
  );

  const opensAt = p.opensAt ? new Date(p.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  // Under the rules (first visit) and after a pass: look again, or the quiet extras.
  const lookButtons = !p.open ? (
    <p className="mt-6 text-sm text-navy/75">
      {opensAt ? (
        <>
          A new drop opens to everyone at {opensAt}. <Link href="/play/member" className="underline">Members</Link> are in now.
        </>
      ) : (
        <>No {p.product}s are ready right now. Check back after my next batch.</>
      )}
    </p>
  ) : (
    <>
      {looks > 0 ? (
        <button className="btn-reveal mt-6 px-9 py-3.5 text-lg" disabled={!!busy} onClick={() => look()} data-pop>
          {busy === "look" ? "Opening…" : "Show me the cards."}
        </button>
      ) : (
        <p className="mt-6 text-sm text-navy/75">That&apos;s {LOOKS_PER_DAY} looks today. More tomorrow.</p>
      )}
      {looks > 0 && p.member && stackLeft && (
        <button className="btn-ghost mt-3 px-5 py-2" disabled={!!busy} onClick={() => look(true)}>
          {busy === "stack" ? "Opening…" : "Show me my member stack"}
        </button>
      )}
      <p className="mt-2 text-xs text-navy/55">
        {looks > 0 ? `${looks} of ${LOOKS_PER_DAY} free looks left today · ` : ""}
        <Link href="/play/member" className="underline">
          {p.member ? "Membership" : "Membership $7.99/mo"}
        </Link>
        {p.hasCard && (
          <>
            {" · "}
            <button className="underline" disabled={!!busy} onClick={buyBlind} data-nopop>
              {busy === "blind" ? "Opening…" : `Dealer's choice · ${usd(PRICES.blind)}`}
            </button>
          </>
        )}
      </p>
    </>
  );

  return (
    <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center text-center">
      {error && <p className="mb-4 rounded border border-navy/20 bg-white px-3 py-2 text-sm text-navy">{error}</p>}

      {phase.k === "intro" && (
        <>
          {/* The stage sits behind the pack only; the rules and the button stay on sand below. */}
          <Stage category={p.category} className="flex aspect-[4/5] w-full max-w-sm items-center justify-center rounded-lg p-12">
            <div className="w-40 sm:w-48">{packArt()}</div>
          </Stage>
          <Rules odds={p.odds} />
          {lookButtons}
        </>
      )}

      {phase.k === "revealing" && (
        <>
          <Stage category={p.category} className="flex items-center justify-center rounded-lg p-3">
            <div className="w-16">{packArt()}</div>
          </Stage>
          {phase.pack.kind === "member" && <p className="mt-3 text-sm font-semibold text-navy">Member stack: your best card is bumped.</p>}
          <div className="after-seal w-full">
            <CardGrid pack={phase.pack} />
          </div>
          {/* Stays on screen while you scroll the cards: the clock and both choices. */}
          <div className="sticky bottom-3 z-30 mt-6 flex w-full max-w-md flex-col items-center gap-1.5 rounded-lg border border-navy/15 border-b-gold bg-sand p-3">
            <p className="text-xs text-navy/65" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
              <span className="font-semibold text-navy">{clock(left)}</span> left · pack value {usd(phase.pack.value)}
            </p>
            <div className="flex items-center gap-5">
              <button className="px-2 py-3 text-base font-semibold text-navy/70 underline-offset-4 hover:underline" disabled={!!busy} onClick={() => passNow("pass")} data-nopop>
                Put them back
              </button>
              <button className="btn-reveal px-8 py-3 text-lg" disabled={!!busy} onClick={keepIt} data-pop>
                {busy === "keep" ? "Keeping…" : `Keep · ${usd(PRICES.keep)}`}
              </button>
            </div>
            <p className="text-xs text-navy/55">
              {p.hasCard ? `Charged to ${p.cardLabel ?? "your saved card"}.` : "Paid with Stripe; your card is saved for next time."} Stored in your Collection until you ship.
            </p>
          </div>
        </>
      )}

      {phase.k === "passed" && (
        <>
          <Stage category={p.category} className="flex items-center justify-center rounded-lg p-6">
            <div className="gone w-32">{packArt()}</div>
          </Stage>
          <p className="mt-5 text-lg font-bold text-navy">{phase.why === "timer" ? "Time's up. The cards went back." : "Back they go."}</p>
          <p className="mt-1 max-w-sm text-sm text-navy/75">Nothing was charged.</p>
          {lookButtons}
        </>
      )}

      {phase.k === "won" && (
        <>
          {seal && <div className="mb-4 w-full max-w-sm">{sealSplit}</div>}
          <p className="font-display text-2xl text-navy">{phase.how === "kept" ? "It's yours!" : "Here's your pack!"}</p>
          <p className="mt-1 text-sm text-navy/75">
            {phase.pack.number ? `Pack ${phase.pack.number} is` : "It's"} in your{" "}
            <Link href="/collection" className="underline">
              Collection
            </Link>
            . Ship it whenever you like, on its own or with other packs.
          </p>
          <div className="after-seal w-full">
            <CardGrid pack={phase.pack} />
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
            <span className="text-navy/40">•</span>
            {o}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-left text-xs text-navy/60">Packs you buy wait in your Collection. Ship one or several together whenever you like; shipping is charged then.</p>
    </div>
  );
}
