"use client";

import { useEffect, useRef, useState } from "react";

/** Most a thumb leans, in degrees; the big card passes ~18. rotateX and rotateY only: no flip, no spin, no back. */
export const THUMB_TILT = 8;
export const BIG_TILT = 18;
const TAP_SLOP = 6; // px of movement before a press counts as a drag

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

/**
 * The real scan (framed on upload). A thumb or mouse drag leans it up to `max` degrees; letting go snaps it back.
 * Pointer and touch only (no gyroscope). A tap calls onTap. `shine`: a small highlight follows the finger (only for
 * holo / reverse / foil / refractor / parallel cards; commons stay matte). Under reduced motion nothing moves.
 * `free`: the enlarged view takes the whole gesture. Otherwise `pan` says which drags still scroll the page (the big card:
 * vertical; the strip: both, and a drag that turns into a scroll snaps back).
 */
export function TiltCard({
  src,
  alt,
  onTap,
  free = false,
  pan = "pan-y",
  max = THUMB_TILT,
  shine = false,
  className = "",
}: {
  src: string;
  alt: string;
  onTap?: () => void;
  free?: boolean;
  pan?: "pan-y" | "pan-x pan-y";
  max?: number;
  shine?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);
  const [t, setT] = useState({ rx: 0, ry: 0, hx: 50, hy: 50, on: false });

  function move(e: React.PointerEvent) {
    const s = start.current;
    if (!s || s.id !== e.pointerId || !ref.current) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP) s.moved = true;
    if (reduced) return;
    const r = ref.current.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setT({ ry: (px - 0.5) * 2 * max, rx: -(py - 0.5) * 2 * max, hx: px * 100, hy: py * 100, on: true });
  }
  function end(e: React.PointerEvent) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    setT((p) => ({ ...p, rx: 0, ry: 0, on: false }));
    if (!s.moved && e.type === "pointerup") onTap?.();
  }

  return (
    <div
      ref={ref}
      className={`relative select-none ${className}`}
      style={{ perspective: "700px", touchAction: free ? "none" : pan }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      role={onTap ? "button" : undefined}
      tabIndex={onTap ? 0 : undefined}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onTap && (e.preventDefault(), onTap())}
      aria-label={onTap ? `${alt}: open larger` : undefined}
    >
      <div
        className="relative"
        style={{
          transform: `rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`,
          transition: t.on ? "transform 60ms linear" : "transform 320ms cubic-bezier(0.2, 0.8, 0.3, 1)",
          transformStyle: "preserve-3d",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} draggable={false} className="block h-auto w-full" />
        {shine && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[5%] rounded-[6%]"
            style={{
              background: `radial-gradient(circle at ${t.hx}% ${t.hy}%, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%)`,
              opacity: t.on ? 1 : 0,
              transition: "opacity 200ms",
              mixBlendMode: "soft-light",
            }}
          />
        )}
      </div>
    </div>
  );
}
