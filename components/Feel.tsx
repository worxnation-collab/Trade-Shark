"use client";

import { useEffect, useState } from "react";
import { isMuted, onMuteChange, pop, setMuted } from "@/lib/client/feel";

/** One listener for the whole app: primary buttons pop. Opt in with data-pop, out with data-nopop. */
export function FeelListener() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(".btn-primary, .btn-coral, [data-pop]");
      if (!el || el.closest("[data-nopop]") || (el as HTMLButtonElement).disabled) return;
      pop();
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}

export function MuteToggle({ className = "" }: { className?: string }) {
  const [muted, setM] = useState(false);
  useEffect(() => {
    setM(isMuted());
    return onMuteChange(setM);
  }, []);
  return (
    <button
      type="button"
      data-nopop
      onClick={() => setMuted(!muted)}
      aria-pressed={muted}
      title={muted ? "Sounds off" : "Sounds on"}
      className={`rounded px-2 py-1 text-sand/70 hover:bg-white/10 hover:text-white ${className}`}
    >
      <span className="sr-only">{muted ? "Unmute sounds" : "Mute sounds"}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
        {muted ? (
          <path d="M17 9l5 6M22 9l-5 6" />
        ) : (
          <>
            <path d="M16.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 6a8.5 8.5 0 0 1 0 12" />
          </>
        )}
      </svg>
    </button>
  );
}
