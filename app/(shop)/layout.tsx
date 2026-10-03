import Link from "next/link";
import { MuteToggle } from "@/components/Feel";
import { Wordmark } from "@/components/SharkFin";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" aria-label="Trade Shark home">
            <Wordmark light compact />
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-xs font-semibold text-sand sm:gap-5 sm:text-sm">
            <Link href="/" className="hover:text-teal">Shop</Link>
            <Link href="/lil-stack" className="hover:text-teal">Lil&apos; Stack</Link>
            <Link href="/about" className="hover:text-teal">About</Link>
            <Link href="/contact" className="hover:text-teal">Contact</Link>
            <MuteToggle className="-my-1" />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-navy/10 bg-sand-2/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-navy/60">
          <span>Trade Shark · Scan it. Price it. List it. · Ships from Florida with tracking.</span>
          <span>Trademarks and card art belong to their respective owners. Trade Shark is not affiliated with any card publisher or league.</span>
        </div>
      </footer>
    </div>
  );
}
