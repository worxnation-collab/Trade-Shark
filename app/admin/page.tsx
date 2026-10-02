import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { StatusChip } from "@/components/StatusChip";
import { db } from "@/lib/db";
import { netAfterFees, type Channel } from "@/lib/pricing/engine";
import { getSettings } from "@/lib/settings";
import { sourceStatus } from "@/lib/sources";
import { STATUSES, type ShippingProfile } from "@/lib/types";
import { money } from "@/lib/util";

export default async function Dashboard() {
  const s = await getSettings();
  const cards = await db.card.findMany({
    select: { status: true, cost: true, listPrice: true, soldPrice: true, soldChannel: true, listedChannel: true, shippingProfile: true, quantity: true, priceConflict: true, identConflict: true, readable: true, pile: true },
  });
  const by = Object.fromEntries(STATUSES.map((st) => [st, cards.filter((c) => c.status === st).length]));
  const live = cards.filter((c) => c.status !== "Archived");
  const cost = live.reduce((a, c) => a + (c.cost ?? 0), 0);
  const listedValue = cards.filter((c) => c.status === "Listed").reduce((a, c) => a + (c.listPrice ?? 0) * c.quantity, 0);
  const readyValue = cards.filter((c) => c.status === "Ready").reduce((a, c) => a + (c.listPrice ?? 0) * c.quantity, 0);
  const sold = cards.filter((c) => c.status === "Sold" && c.soldPrice != null);
  const soldProfit = sold.reduce((a, c) => {
    const ch = (c.soldChannel || c.listedChannel || "ebay") as Channel;
    return a + netAfterFees(c.soldPrice!, ["ebay", "tcgplayer", "stripe", "local"].includes(ch) ? ch : "ebay", c.shippingProfile as ShippingProfile, s).net - (c.cost ?? 0);
  }, 0);
  const missingPrice = live.filter((c) => c.readable && c.listPrice == null && !["Sold"].includes(c.status)).length;
  const conflicts = live.filter((c) => c.priceConflict || c.identConflict).length;
  const piles = live.filter((c) => c.pile !== "none").length;
  const batches = await db.batch.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { _count: { select: { cards: true } } } });
  const sources = sourceStatus();

  const Tile = ({ label, value, href, tone = "" }: { label: string; value: string | number; href?: string; tone?: string }) => {
    const inner = (
      <div className={`card p-4 ${tone}`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-navy/50">{label}</div>
        <div className="mt-1 text-2xl font-extrabold">{value}</div>
      </div>
    );
    return href ? <Link href={href} className="lift block rounded-lg">{inner}</Link> : inner;
  };

  if (!cards.length)
    return (
      <EmptyState title="Nothing in the tank yet">
        <p>Drop in a scanner, phone, or flatbed batch to get started.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href="/admin/upload" className="btn-primary">Upload a batch</Link>
          <Link href="/admin/flatbed" className="btn-ghost">Flatbed split</Link>
        </div>
      </EmptyState>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <Link href="/admin/upload" className="btn-primary">+ Upload batch</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {STATUSES.map((st) => (
          <Link key={st} href={`/admin/cards?status=${st}`} className="card lift block p-3 hover:border-teal">
            <StatusChip status={st} />
            <div className="mt-2 text-2xl font-extrabold">{by[st]}</div>
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Cost basis" value={money(cost)} />
        <Tile label="Ready value" value={money(readyValue)} href="/admin/cards?status=Ready" />
        <Tile label="Listed value" value={money(listedValue)} href="/admin/cards?status=Listed" />
        <Tile label="Sold profit (net)" value={money(soldProfit)} href="/admin/cards?status=Sold" tone={soldProfit < 0 ? "border-coral" : ""} />
        <Tile label="Missing a price" value={missingPrice} href="/admin/cards?filter=noprice" tone={missingPrice ? "border-coral" : ""} />
        <Tile label="Conflicting sources" value={conflicts} href="/admin/cards?filter=conflict" tone={conflicts ? "border-coral" : ""} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Recent batches</h2>
            <span className="text-xs text-navy/50">{piles} card(s) in review piles</span>
          </div>
          <ul className="divide-y divide-navy/5 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <Link href={`/admin/batches/${b.id}`} className="font-semibold hover:text-teal">{b.name}</Link>
                <span className="text-navy/50">{b._count.cards} cards · {b.createdAt.toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-bold">Sources</h2>
          <ul className="space-y-1 text-sm">
            {sources.map((src) => (
              <li key={src.id + src.label} className="flex items-center justify-between gap-3">
                <span>{src.label}</span>
                <span className={`chip ${src.ok ? "bg-teal/15 text-teal-2" : "bg-navy/5 text-navy/50"}`}>{src.ok ? "on" : src.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
