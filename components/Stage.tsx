/**
 * The pack stage is a flat color, never a photograph (classes in app/globals.css): Pokemon is near-black with one soft
 * light behind the pack; Baseball and Football are two flat daylight felts. Only the pack sits on it. Never put rules,
 * prices, names or buttons inside a Stage; they stay on the sand page.
 */
export function Stage({ category, className = "", children }: { category: string; className?: string; children: React.ReactNode }) {
  return <div className={`stage stage-${category} ${className}`}>{children}</div>;
}

/** A plain page title: navy Archivo Black with a gold hairline under it, on sand. */
export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="text-center">
      <h1 className="font-display text-4xl tracking-tight text-navy sm:text-5xl">{title}</h1>
      <div className="gold-rule mx-auto mt-3" aria-hidden />
      {children && <div className="mx-auto mt-4 max-w-lg text-lg font-semibold leading-snug text-navy">{children}</div>}
    </div>
  );
}
