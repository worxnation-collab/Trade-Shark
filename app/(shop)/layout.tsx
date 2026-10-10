import Link from "next/link";
import { MuteToggle } from "@/components/Feel";
import { Wordmark } from "@/components/Brand";
import { consignOpen } from "@/lib/partners";
import { POKEROLL_URL } from "@/lib/rosterRollLink";

/** One product with pokeroll.fun: the Pokéroll mark and name, ink on the light canvas, the two rolls up front. */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const open = await consignOpen().catch(() => false);
  return (
    <div className="flex min-h-screen flex-col bg-sand">
      <header className="border-b border-navy/10 bg-sand">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          <Link href="/" aria-label="Pokéroll home">
            <Wordmark compact />
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-xs font-semibold text-navy sm:gap-5 sm:text-sm">
            <a href={POKEROLL_URL} className="hover:underline">Lineup</a>
            <Link href="/packs/pokemon" className="hover:underline">Packs</Link>
            <Link href="/case" className="hover:underline">The case</Link>
            <Link href="/collection" className="hover:underline">Collection</Link>
            <Link href="/about" className="hidden hover:underline sm:inline">About</Link>
            <Link href="/contact" className="hidden hover:underline sm:inline">Contact</Link>
            <MuteToggle className="-my-1" />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">{children}</main>
      <footer className="border-t border-navy/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-navy/60">
          <span className="font-display text-navy">Pokéroll</span>
          <span>
            <Link href="/about" className="underline sm:hidden">About</Link>
            <span className="sm:hidden"> · </span>
            <Link href="/contact" className="underline sm:hidden">Contact</Link>
            <span className="sm:hidden"> · </span>
            Ships from Florida with tracking ·{" "}
            <Link href="/consign" className="underline">
              {open ? "Send in your bulk" : "Send in your bulk (coming soon)"}
            </Link>
          </span>
          <span className="w-full">
            Pokéroll is a fan-run card shop, not affiliated with Nintendo, The Pokémon Company, or any card publisher or league. Trademarks and card
            art belong to their respective owners.
          </span>
        </div>
      </footer>
    </div>
  );
}
