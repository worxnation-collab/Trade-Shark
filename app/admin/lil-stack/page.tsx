import Link from "next/link";
import { CATEGORIES, isCategory, type Category } from "@/lib/categories";
import { db } from "@/lib/db";
import { deskData } from "@/lib/desk";
import { chaseList } from "@/lib/game/packs";
import { sweepExpired } from "@/lib/game/play";
import { getSettings } from "@/lib/settings";
import { money } from "@/lib/util";
import { EBAY_MIN, ebayLane } from "@/lib/ebay/seller";
import cvPkg from "@techstark/opencv-js/package.json";
import pdfPkg from "pdfjs-dist/package.json";
import { IngestTicker } from "@/components/IngestTicker";
import { PdfInbox } from "@/components/PdfInbox";
import { ingestProgress } from "@/lib/ingestQueue";
import { EbayList, EbayDisconnect, ListMore, PackedButton, FacebookSale, HoldFix, PlaceButton, PriceBox, VoidFacebook } from "./DeskActions";
import { CategoryPicker, ChaseToggle } from "./LilStackTools";

export const metadata = { title: "Pack desk" };
export const dynamic = "force-dynamic";

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="card overflow-hidden">
      <h2 className={`flex items-center gap-3 px-4 py-3 text-xl font-black ${done ? "bg-teal/10" : "bg-navy text-white"}`}>
        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${done ? "bg-teal text-white" : "bg-gold text-navy"}`}>{n}</span>
        {title}
      </h2>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

/** The founder pack desk: scan → sort by slot code → build 10 → pull by slot code → confirm. One category at a time. */
const EBAY_NOTES: Record<string, string> = {"connected": "eBay seller login connected.", "failed": "eBay login didn't finish. Try Connect eBay again.", "declined": "eBay login was cancelled.", "noapp": "eBay app keys (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME) aren't set on the server yet."};

export default async function PackDesk({ searchParams }: { searchParams: Promise<{ c?: string; received?: string; skipped?: string; ebay?: string }> }) {
  await sweepExpired();
  const { c, received, skipped, ebay: ebayNote } = await searchParams;
  const ingesting = await ingestProgress();
  const category: Category = isCategory(c) ? c : "pokemon";
  const fbSales = await db.gamePack.findMany({ where: { status: "sold-facebook" }, orderBy: { closedAt: "desc" }, take: 10, select: { id: true, number: true, category: true, closedAt: true } });
  const [d, s, chase, noCategory, eb] = await Promise.all([
    deskData(category),
    getSettings(),
    chaseList(category),
    db.card.findMany({ where: { category: null, status: { in: ["Identified", "Priced", "BulkHold", "NeedsLook"] }, readable: true }, take: 40, orderBy: { createdAt: "asc" } }),
    ebayLane(),
  ]);
  const product = CATEGORIES.find((x) => x.key === category)!.product;
  const onDesk = d.columns.reduce((n, col) => n + col.cards.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">Pack desk</h1>
          <p className="mt-1 text-sm font-semibold">
            <span className={`chip ${d.counts.demo ? "bg-coral/20 text-coral" : "bg-teal/15 text-teal-2"}`}>Demo cards: {d.counts.demo}</span>{" "}
            <span className="chip bg-navy/5">Real scans: {d.counts.real}</span> <span className="chip bg-navy/5">{product} cards on the desk: {onDesk}</span>{" "}
            <span className="chip bg-navy/5">{product}s on sale: {d.onSale}</span>
          </p>
        </div>
        <nav className="flex gap-1">
          {CATEGORIES.map((x) => (
            <Link key={x.key} href={`/admin/lil-stack?c=${x.key}`} className={`rounded-lg px-4 py-2 text-base font-black ${x.key === category ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-navy/20"}`}>
              {x.name}
            </Link>
          ))}
        </nav>
      </div>

      <Step n={1} title="Scan a batch" done={d.counts.inbox === 0 && onDesk > 0 && !ingesting.length}>
        {received && <p className="text-xl font-black">{received}</p>}
        {skipped && <p className="text-sm">Skipped, already ingested: {skipped}</p>}
        <IngestTicker initial={ingesting} />
        <PdfInbox pdfjsVersion={pdfPkg.version} cvSrc={`/vendor/opencv-${cvPkg.version}.js`} />
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/upload" className="btn-coral px-5 py-2.5 text-base">
            Upload scans
          </Link>
          <Link href="/admin/flatbed" className="btn-ghost px-5 py-2.5 text-base">
            Flatbed sheet
          </Link>
          <span className="text-sm text-navy/70">
            Images, flatbed sheets and PDFs. Every scan is cropped and turned upright first; each card lands in its bin as soon as it is priced. {d.counts.inbox ? `${d.counts.inbox} card(s) still in the Inbox (no name yet).` : ""}
          </span>
        </div>
      </Step>

      <Step n={2} title="Sort into bins by the location code" done={d.toPlace.length === 0 && onDesk > 0}>
        {d.toPlace.length > 0 ? (
          <>
            <p className="text-base font-semibold">Put each card in its slot, then tap Placed.</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {d.toPlace.slice(0, 60).map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border-2 border-navy/15 bg-white p-2">
                  {c.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumb} alt="" className="h-14 w-10 rounded object-cover" loading="lazy" />
                  )}
                  <span className="min-w-0">
                    <span className="block font-mono text-2xl font-black leading-none">{c.code}</span>
                    <span className="block truncate text-xs">{c.name}</span>
                  </span>
                </li>
              ))}
            </ul>
            {d.toPlace.length > 60 && <p className="text-sm text-navy/60">…and {d.toPlace.length - 60} more.</p>}
            <PlaceButton ids={d.toPlace.slice(0, 60).map((c) => c.id)} />
          </>
        ) : (
          <p className="text-sm text-navy/70">Every card is in its slot.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          {d.columns.map((col) => (
            <div key={col.tray} className={`rounded-xl border-2 ${col.tray === "H" ? "border-coral/50 bg-coral/5" : "border-navy/15 bg-white"}`}>
              <div className="border-b-2 border-navy/10 px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black">{col.label}</span>
                  <span className="text-2xl font-black">{col.cards.length}</span>
                </div>
                <div className="text-xs text-navy/60">
                  Tray {col.tray} · {col.note}
                </div>
              </div>
              <ul className="max-h-[32rem] divide-y divide-navy/5 overflow-y-auto">
                {col.cards.slice(0, 150).map((c) => (
                  <li key={c.id} className={`flex items-center gap-2 px-2 py-1.5 ${c.sorted ? "" : "bg-gold/15"}`}>
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumb} alt="" className="h-12 w-9 shrink-0 rounded object-cover" loading="lazy" />
                    ) : (
                      <span className="h-12 w-9 shrink-0 rounded bg-navy/10" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-lg font-black leading-tight">{c.code}</span>
                      <span className="block truncate text-xs">{c.name}</span>
                      <span className="block text-xs text-navy/60">
                        {c.price == null ? "no price" : money(c.price)}
                        {c.chase && " · CHASE"}
                        {!c.sorted && " · not placed yet"}
                      </span>
                      {col.tray === "U" ? (
                        <PriceBox id={c.id} />
                      ) : c.why && (
                        <Link href={`/admin/review/${c.id}`} className="block text-xs font-semibold text-coral underline">
                          {c.why}
                        </Link>
                      )}
                      {c.rotation && <HoldFix id={c.id} />}
                    </span>
                  </li>
                ))}
                {col.cards.length === 0 && <li className="px-3 py-4 text-sm text-navy/50">Empty</li>}
                {col.cards.length > 150 && <li className="px-3 py-2 text-xs text-navy/60">…and {col.cards.length - 150} more</li>}
              </ul>
            </div>
          ))}
        </div>
        {noCategory.length > 0 && (
          <div className="rounded-lg bg-coral/10 p-3 text-sm">
            <b>{noCategory.length} card(s) have no pack category</b> and can&apos;t go on the desk. Pick one:
            <ul className="mt-2 space-y-1">
              {noCategory.map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <Link href={`/admin/review/${x.id}`} className="underline">
                    {(x.game === "Sports" ? x.player || x.name : x.name) || "Unnamed card"}
                  </Link>
                  <CategoryPicker cardId={x.id} value={x.category} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Step>

      <Step n={3} title="Packs on sale: pull these" done={d.toPull.length === 0}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base font-bold">
            {d.toPull.length} listed pack{d.toPull.length === 1 ? "" : "s"} to pull ·{" "}
            {d.budget > 0 ? `the engine can list ${d.budget} more on its own` : "listing paused until you press List next 10"}
          </p>
          <ListMore category={category} />
        </div>
        {d.budget > 0 && d.short && <p className="text-sm text-navy/70">Not listed right now: {d.short}.</p>}
        {d.toPull.map((p) => (
          <div key={p.id} className={`rounded-xl border-2 p-3 ${p.sold ? "border-coral" : "border-navy"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-black">
                Pack {p.number} <span className="text-base font-bold text-navy/60">{product}</span>
                {p.sold && <span className="ml-2 rounded bg-coral px-2 py-0.5 text-sm text-white">SOLD · pull first</span>}
                {p.kind !== "base" && <span className="ml-2 rounded bg-navy px-2 py-0.5 text-sm text-white">{p.kind.toUpperCase()}</span>}
              </h3>
              <span className="text-sm text-navy/60">
                value {money(p.value)} ·{" "}
                <Link href={`/admin/packs/${p.id}`} className="underline">
                  print
                </Link>
              </span>
            </div>
            <ol className="mt-2 divide-y divide-navy/10">
              {p.cards.map((c, i) => (
                <li key={c.id} className={`grid grid-cols-[2rem_1fr_auto_auto] items-baseline gap-3 py-1.5 ${c.hit ? "bg-coral/5" : ""}`}>
                  <span className="text-sm text-navy/50">{i + 1}.</span>
                  <span className="truncate font-semibold">
                    {c.name}
                    {c.hit && <span className="ml-1 text-xs font-black text-coral">HIT</span>}
                  </span>
                  <span className="text-sm">{money(c.price)}</span>
                  <span className="font-mono text-2xl font-black">{c.code}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3">
              <PackedButton id={p.id} label={`Pack ${p.number}`} />
            </div>
          </div>
        ))}
        <p className="text-sm text-navy/60">
          Packs go on sale as soon as the engine builds them; their 12 cards are held for that pack, so no two buyers get the same card. Packed only means you pulled the
          stack. Never two of the same card, never an energy card, never more than two of one Pokémon type, never more than two cards of one player, never an unpriced card.
        </p>
      </Step>

      <section className="card space-y-2 p-4">
        <h2 className="text-lg font-black">Facebook sale</h2>
        <p className="text-sm text-navy/70">Sold a pack on Marketplace? Pick its category: the next ready stack comes off the site (no one can peek or buy it) and you pull it.</p>
        <FacebookSale />
        {fbSales.length > 0 && (
          <ul className="space-y-1 border-t border-navy/10 pt-2 text-sm">
            {fbSales.map((p) => {
              const label = `${CATEGORIES.find((x) => x.key === p.category)?.product ?? "Pack"} ${p.number ?? ""}`;
              return (
                <li key={p.id} className="flex items-center gap-3">
                  <Link href={`/admin/packs/${p.id}`} className="font-semibold underline">
                    {label}
                  </Link>
                  <span className="text-navy/60">sold on Facebook {p.closedAt?.toLocaleDateString()}</span>
                  <VoidFacebook id={p.id} label={label} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="ebay" className="card space-y-3 p-4">
        <h2 className="text-lg font-black">eBay lane</h2>
        <p className="text-sm text-navy/70">
          One listing per loose card priced ${EBAY_MIN} or more (never a card in a pack, never unpriced, never energy), with its scan and name. Sold ones are checked every 5 minutes
          and leave stock as sold-ebay.
        </p>
        {ebayNote && <p className="text-sm font-semibold">{EBAY_NOTES[ebayNote] ?? ""}</p>}
        {!eb.app ? (
          <p className="text-sm font-semibold text-coral">Not set up: the eBay app keys aren&apos;t on the server yet. Nothing lists until they are and the seller login is connected.</p>
        ) : !eb.connected ? (
          <div className="space-y-1">
            <a href="/api/admin/ebay/connect" className="btn-dark inline-block px-5 py-2 text-base">
              Connect eBay
            </a>
            <p className="text-sm text-navy/60">Nothing lists until the seller login is connected. {eb.ready} cards would qualify.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <EbayList ready={eb.ready} />
            <EbayDisconnect />
          </div>
        )}
        {eb.failed.length > 0 && (
          <div className="rounded-lg bg-coral/10 p-3 text-sm">
            <p className="font-bold text-coral">eBay didn&apos;t take {eb.failed.length} card{eb.failed.length === 1 ? "" : "s"}. They&apos;re still in stock.</p>
            <ul className="mt-1 space-y-1">
              {eb.failed.slice(0, 10).map((c) => (
                <li key={c.id}>
                  <span className="font-semibold">{c.title}</span> · <span className="text-navy/70">{c.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {eb.sold.length > 0 && (
          <div className="text-sm">
            <p className="font-bold">Sold on eBay: pull and ship</p>
            <ul className="mt-1 space-y-1">
              {eb.sold.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-lg font-black">{c.code}</span>
                  <span className="font-semibold">{c.title}</span>
                  <span>{money(c.soldPrice ?? c.price)}</span>
                  <span className="chip bg-teal/15 text-teal-2">sold-ebay</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {eb.onEbay.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-bold">On eBay now ({eb.onEbay.length})</summary>
            <ul className="mt-1 space-y-1">
              {eb.onEbay.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-black">{c.code}</span>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                      {c.title}
                    </a>
                  ) : (
                    <span>{c.title}</span>
                  )}
                  <span>{money(c.price)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="font-bold">Chase cards ($10+)</h2>
        <ChaseToggle category={category} on={!!s.chaseOn?.[category]} canTurnOn={chase.length > 0} />
        <p className="text-navy/60">Off: $10+ cards wait in Hold. On: about 2 in 100 packs get one.</p>
      </section>
    </div>
  );
}
