import { stageArt } from "@/lib/brandAssets";

/**
 * The pack stage: this category's quiet Gemini backdrop behind the pack, nothing else on it. No art = plain navy.
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

/** A plain page title: navy type with a thin gold line under it, on cream. */
export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="text-center">
      <h1 className="text-4xl font-black tracking-tight text-navy sm:text-5xl">{title}</h1>
      <div className="gold-rule mx-auto mt-3" aria-hidden />
      {children && <div className="mx-auto mt-4 max-w-lg text-lg font-semibold leading-snug text-navy">{children}</div>}
    </div>
  );
}
