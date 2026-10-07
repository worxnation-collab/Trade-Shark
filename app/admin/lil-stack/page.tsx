import Link from "next/link";
import { CATEGORIES, isCategory, type Category } from "@/lib/categories";
import { db } from "@/lib/db";
import { deskData } from "@/lib/desk";
import { chaseList } from "@/lib/game/packs";
import { sweepExpired } from "@/lib/game/play";
import { getSettings } from "@/lib/settings";
import { money } from "@/lib/util";
import cvPkg from "@techstark/opencv-js/package.json";
import pdfPkg from "pdfjs-dist/package.json";
import { IngestTicker } from "@/components/IngestTicker";
import { PdfInbox } from "@/components/PdfInbox";
import { ingestProgress } from "@/lib/ingestQueue";
import { ConfirmPack, FacebookSale, HoldFix, PlaceButton, PriceBox, VoidFacebook } from "./DeskActions";
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
export default async function PackDesk({ searchParams }: { searchParams: Promise<{ c?: string; received?: string; skipped?: string }> }) {
  await sweepExpired();
  const { c, received, skipped } = await searchParams;
  const ingesting = await ingestProgress();
  const category: Category = isCategory(c) ? c : "pokemon";
  const fbSales = await db.gamePack.findMany({ where: { status: "sold-facebook" }, orderBy: { closedAt: "desc" }, take: 10, select: { id: true, number: true, category: true, closedAt: true } });
  const [d, s, chase, noCategory] = await Promise.all([
    deskData(category),
    getSettings(),
    chaseList(category),
    db.card.findMany({ where: { category: null, status: { in: ["Identified", "Priced", "BulkHold", "NeedsLook"] }, readable: true }, take: 40, orderBy: { createdAt: "asc" } }),
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

      <Step n={3} title="Pull the next pack" done={false}>
        {d.next ? (
          <div className="rounded-xl border-2 border-navy p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-black">
                Pack {d.next.number} <span className="text-base font-bold text-navy/60">{product}</span>
                {d.next.kind !== "base" && <span className="ml-2 rounded bg-coral px-2 py-0.5 text-sm text-white">{d.next.kind.toUpperCase()}</span>}
              </h3>
              <span className="text-sm text-navy/60">
                value {money(d.next.value)} ·{" "}
                <Link href={`/admin/packs/${d.next.id}`} className="underline">
                  print
                </Link>
              </span>
            </div>
            <ol className="mt-2 divide-y divide-navy/10">
              {d.next.cards.map((c, i) => (
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
              <ConfirmPack id={d.next.id} label={`Pack ${d.next.number}`} />
            </div>
          </div>
        ) : (
          <p className="text-lg font-bold">
            No pack ready yet. <span className="text-coral">Missing: {d.short ?? "placed, priced cards"}.</span>
          </p>
        )}
        <p className="text-sm text-navy/60">
          One pack at a time: pull the 12 cards by their codes, then press Packed. The next pack prints after that. Never two of the same card, never an energy card, never more than two
          of one Pokémon type, never more than two cards of one player, never an unpriced card.
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

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="font-bold">Chase cards ($10+)</h2>
        <ChaseToggle category={category} on={!!s.chaseOn?.[category]} canTurnOn={chase.length > 0} />
        <p className="text-navy/60">Off: $10+ cards wait in Hold. On: about 2 in 100 packs get one.</p>
      </section>
    </div>
  );
}
