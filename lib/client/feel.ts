/**
 * Small moments of delight that never get in the way:
 * - pop(): one soft synthesized bubble pop (~140 ms), no audio files to load.
 * - confetti(el): one ~1.2 s teal/coral/navy burst from an element, then the canvas is removed.
 * Everything is fire-and-forget and swallows its own errors, so it can't block a save.
 */

const MUTE_KEY = "ts-mute";
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* storage blocked: still honor it for this page */
  }
  listeners.forEach((fn) => fn(m));
}

export function onMuteChange(fn: (muted: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

let ctx: AudioContext | null = null;

export function pop() {
  if (typeof window === "undefined" || isMuted()) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // A quick downward chirp reads as a bubble.
    osc.frequency.setValueAtTime(720, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.11);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  } catch {
    /* sound is optional */
  }
}

const COLORS = ["#1AA6A6", "#E85D4C", "#1AA6A6", "#E85D4C", "#0B1F3A", "#F4EFE6"];

/** Burst from an element (or a point). Skipped entirely for reduced motion. */
export function confetti(from?: Element | { x: number; y: number } | null) {
  if (typeof window === "undefined" || reducedMotion()) return;
  try {
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 3;
    if (from && "getBoundingClientRect" in from) {
      const r = from.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else if (from) ({ x, y } = from);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "60" });
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    document.body.appendChild(canvas);
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);

    const parts = Array.from({ length: 70 }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const v = 5 + Math.random() * 7;
      return {
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        c: COLORS[(Math.random() * COLORS.length) | 0],
      };
    });
    const DURATION = 1200;
    const start = performance.now();
    const frame = (now: number) => {
      const p = (now - start) / DURATION;
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (p >= 1) {
        canvas.remove();
        return;
      }
      g.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      for (const q of parts) {
        q.vy += 0.32;
        q.vx *= 0.985;
        q.x += q.vx;
        q.y += q.vy;
        q.rot += q.vr;
        g.save();
        g.translate(q.x, q.y);
        g.rotate(q.rot);
        g.fillStyle = q.c;
        g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
        g.restore();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch {
    /* confetti is optional */
  }
}
