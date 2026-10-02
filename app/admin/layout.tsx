import Link from "next/link";
import { Wordmark } from "@/components/SharkFin";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/upload", "Upload"],
  ["/admin/batches", "Batches"],
  ["/admin/cards", "Inventory"],
  ["/admin/export", "Export"],
  ["/admin/settings", "Settings"],
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
