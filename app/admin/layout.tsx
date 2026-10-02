import Link from "next/link";
import { Wordmark } from "@/components/SharkFin";
import { missingConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/upload", "Upload"],
  ["/admin/flatbed", "Flatbed"],
  ["/admin/batches", "Batches"],
  ["/admin/cards", "Inventory"],
  ["/admin/export", "Export"],
  ["/admin/settings", "Settings"],
] as const;

function SetupNeeded({ missing }: { missing: { key: string; why: string }[] }) {
  return (
    <div className="card mx-auto max-w-2xl space-y-3 p-6">
      <h1 className="text-xl font-extrabold">Finish connecting the desk</h1>
      <p className="text-sm text-navy/70">
        Add these in Netlify → trade-shark → Project configuration → Environment variables, then redeploy.
      </p>
      <ul className="space-y-2 text-sm">
        {missing.map((m) => (
          <li key={m.key}>
            <code className="rounded bg-sand-2 px-1.5 py-0.5 font-semibold">{m.key}</code> <span className="text-navy/60">{m.why}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const missing = missingConfig();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-navy">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-2.5">
          <Link href="/admin" className="flex items-center gap-3">
            <Wordmark light />
            <span className="hidden text-xs font-semibold uppercase tracking-widest text-sand/50 sm:inline">Listing desk</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm font-semibold">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2.5 py-1 text-sand hover:bg-white/10 hover:text-white">
                {label}
              </Link>
            ))}
            <Link href="/" className="rounded px-2.5 py-1 text-teal hover:bg-white/10">Shop ↗</Link>
            <form action="/api/logout" method="post">
              <button className="rounded px-2.5 py-1 text-sand/60 hover:text-coral">Lock</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{missing.length ? <SetupNeeded missing={missing} /> : children}</main>
    </div>
  );
}
