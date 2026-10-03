import { DISCLAIMERS } from "@/lib/disclaimers";

export function Disclaimer({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <ul className={`space-y-0.5 text-[11px] leading-snug ${dark ? "text-sand/50" : "text-navy/50"} ${className}`} aria-label="The small print">
      {DISCLAIMERS.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  );
}
