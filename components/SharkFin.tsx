/** Geometric shark-fin mark. Pure shapes, no third-party art. */
export function SharkFin({ size = 28, className = "", mono = false }: { size?: number; className?: string; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <polygon points="6,24 19,5 24,9 25,24" fill={mono ? "currentColor" : "#1AA6A6"} />
      <polygon points="19,5 24,9 25,24 17,24" fill={mono ? "currentColor" : "#0B1F3A"} opacity={mono ? 0.4 : 0.25} />
      <rect x="3" y="25.5" width="26" height="2.5" rx="1.25" fill={mono ? "currentColor" : "#E85D4C"} />
    </svg>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <SharkFin />
      <span className={`text-lg font-extrabold tracking-tight ${light ? "text-white" : "text-navy"}`}>
        Trade <span className="text-teal">Shark</span>
      </span>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <SharkFin size={56} />
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <div className="max-w-md text-sm text-navy/70">{children}</div>}
    </div>
  );
}
