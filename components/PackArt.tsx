import { SharkFin } from "./SharkFin";

/** Drawn pack used when there's no generated art (or no GEMINI_API_KEY). */
export function CssPack({ progress = 0, torn = false }: { progress?: number; torn?: boolean }) {
  return (
    <div className={`ls-pack relative aspect-[5/7] w-full ${torn ? "ls-torn" : ""}`}>
      {!torn && (
        <div className="ls-crimp absolute inset-x-0 top-0 h-[7%] origin-left" style={{ transform: `rotate(${-progress * 7}deg) translateY(${-progress * 8}px)` }} />
      )}
      <div className="ls-body absolute inset-x-0 bottom-0 top-[7%] overflow-hidden">
        <div className="absolute inset-x-0 top-[24%] flex justify-center">
          <SharkFin size={torn ? 40 : 84} />
        </div>
        <div className="absolute inset-x-0 top-[58%] bg-sand py-[5%] text-center">
          <span className={`font-extrabold uppercase tracking-[0.25em] text-navy ${torn ? "text-[9px]" : "text-sm"}`}>12 Cards</span>
        </div>
        {!torn && <div className="absolute inset-x-0 bottom-[9%] text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-gold">Trade Shark</div>}
      </div>
      <div className="ls-crimp absolute inset-x-0 bottom-0 h-[6%]" />
    </div>
  );
}
