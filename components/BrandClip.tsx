"use client";

import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "@/lib/client/feel";

/**
 * A short Gemini/Veo brand clip from public/brand, played once, muted, inline. Calls onDone when it ends (or right
 * away under reduced motion, or if the clip can't play), so the game never waits on an animation.
 */
export function BrandClip({ src, poster, onDone, className = "", blend = false }: { src: string; poster?: string; onDone?: () => void; className?: string; blend?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [skip, setSkip] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone?.();
  };
  useEffect(() => {
    if (reducedMotion()) {
      setSkip(true);
      finish();
      return;
    }
    const v = ref.current;
    v?.play().catch(() => finish());
    const cap = window.setTimeout(finish, 5000); // never hang the screen on a slow clip
    return () => window.clearTimeout(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (skip) return null;
  return (
    <video
      ref={ref}
      poster={poster}
      muted
      playsInline
      preload="auto"
      onEnded={finish}
      onError={finish}
      aria-hidden
      className={className}
      style={blend ? { mixBlendMode: "screen" } : undefined}
    >
      <source src={src.replace(/\.mp4$/, ".webm")} type="video/webm" />
      <source src={src} type="video/mp4" />
    </video>
  );
}
