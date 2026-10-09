/** The small fin mark: a navy fin on one gold edge. Pure shapes, no third-party art. */
export function SharkFin({ size = 28, className = "", mono = false }: { size?: number; className?: string; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      {/* Navy ink via the token, so on the desk bench the fin turns light on its own. */}
      <polygon points="6,24 19,5 24,9 25,24" style={{ fill: mono ? "currentColor" : "var(--color-navy, #0B1F3A)" }} />
      <rect x="3" y="25.5" width="26" height="2" rx="1" fill={mono ? "currentColor" : "#D9A441"} />
    </svg>
  );
}

/** compact: just the fin on phones (the shop header needs the room for its links). */
export function Wordmark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <SharkFin mono={light} className={light ? "text-white/90" : ""} />
      <span className={`${compact ? "hidden sm:inline" : ""} whitespace-nowrap font-display text-lg tracking-tight ${light ? "text-white" : "text-navy"}`}>
        Trade Shark
      </span>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <SharkFin size={40} />
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <div className="max-w-md text-sm text-navy/70">{children}</div>}
    </div>
  );
}
