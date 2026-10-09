"use client";

import { useEffect } from "react";
import { confetti } from "@/lib/client/feel";

/** Fires one burst per key per browser session (a reload doesn't re-fire). */
export function ConfettiOnce({ id }: { id: string }) {
  useEffect(() => {
    const key = `ts-confetti-${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* no storage: fire anyway, once per mount */
    }
    const t = setTimeout(() => confetti(document.getElementById("thanks-fin")), 150);
    return () => clearTimeout(t);
  }, [id]);
  return null;
}
