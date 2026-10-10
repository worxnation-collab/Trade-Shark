/* eslint-disable @next/next/no-img-element */

/** The Pokéroll mark (public/logo-mark.png), the same one pokeroll.fun uses. `size` in px. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-[28%] ring-1 ring-black/10 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** The mark and the name. compact: just the mark on phones (the shop header needs the room for its links). */
export function Wordmark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={26} />
      <span className={`${compact ? "hidden sm:inline" : ""} whitespace-nowrap font-display text-lg tracking-tight ${light ? "text-white" : "text-navy"}`}>
        Pokéroll
      </span>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <LogoMark size={40} />
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <div className="max-w-md text-sm text-navy/70">{children}</div>}
    </div>
  );
}
