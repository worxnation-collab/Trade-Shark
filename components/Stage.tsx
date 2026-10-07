import { stageArt } from "@/lib/brandAssets";

/**
 * The pack stage: this category's Gemini backdrop behind the pack, nothing else on it. No art made yet = plain navy.
 * Never put rules, prices or buttons inside a Stage.
 */
export function Stage({ category, className = "", children }: { category: string; className?: string; children: React.ReactNode }) {
  const art = stageArt(category);
  return (
    <div className={`stage ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art && <img src={art} alt="" aria-hidden className="stage-art" draggable={false} />}
      {children}
    </div>
  );
}

/** A short wide header band with a title on it. `title` is a sticker image when there is one, else bold type. */
export function HeaderBand({ art, children, className = "" }: { art: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={`stage flex min-h-36 items-center justify-center rounded-2xl px-4 py-6 sm:min-h-44 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art && <img src={art} alt="" aria-hidden className="stage-art" />}
      {children}
    </div>
  );
}
