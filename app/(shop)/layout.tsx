import Link from "next/link";
import { MuteToggle } from "@/components/Feel";
import { Wordmark } from "@/components/SharkFin";
import { patternArt, titleArt } from "@/lib/brandAssets";
import { consignOpen } from "@/lib/partners";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const open = await consignOpen().catch(() => false);
  const pattern = patternArt();
  const title = titleArt("tradeshark");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" aria-label="Trade Shark home">
            <Wordmark light compact />
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-xs font-semibold text-sand sm:gap-5 sm:text-sm">
            <Link href="/" className="hover:text-teal">Packs</Link>
            <Link href="/collection" className="hover:text-teal">Collection</Link>
            <Link href="/about" className="hover:text-teal">About</Link>
            <Link href="/contact" className="hover:text-teal">Contact</Link>
            <MuteToggle className="-my-1" />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t-4 border-navy bg-sand-2/60">
        {pattern && <div className="pattern-band h-10 opacity-70" style={{ backgroundImage: `url(${pattern})` }} aria-hidden />}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-navy/60">
          {title ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={title} alt="TradeShark" className="h-10 w-auto -rotate-2" />
          ) : (
            <span className="font-black text-navy">TradeShark</span>
          )}
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
