import Link from "next/link";
import { MuteToggle } from "@/components/Feel";
import { Wordmark } from "@/components/SharkFin";
import { consignOpen } from "@/lib/partners";

/** The quiet card counter: a short cream header with the fin mark, navy ink, one gold edge. */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const open = await consignOpen().catch(() => false);
  return (
    <div className="flex min-h-screen flex-col bg-sand">
      <header className="border-b-2 border-gold bg-sand">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          <Link href="/" aria-label="Trade Shark home">
            <Wordmark compact />
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-xs font-semibold text-navy sm:gap-5 sm:text-sm">
            <Link href="/" className="hover:underline">Packs</Link>
            <Link href="/case" className="hover:underline">The case</Link>
            <Link href="/collection" className="hover:underline">Collection</Link>
            <Link href="/about" className="hover:underline">About</Link>
            <Link href="/contact" className="hover:underline">Contact</Link>
            <MuteToggle className="-my-1" />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">{children}</main>
      <footer className="border-t border-navy/15">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-navy/60">
          <span className="font-extrabold text-navy">Trade Shark</span>
          <span>
            Ships from Florida with tracking ·{" "}
            <Link href="/consign" className="underline">
              {open ? "Send in your bulk" : "Send in your bulk (coming soon)"}
            </Link>
          </span>
          <span className="w-full">Trademarks and card art belong to their respective owners. Trade Shark is not affiliated with any card publisher or league.</span>
        </div>
      </footer>
    </div>
  );
}
