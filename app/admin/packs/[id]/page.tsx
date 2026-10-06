import Link from "next/link";
import { notFound } from "next/navigation";
import { productName } from "@/lib/categories";
import { db } from "@/lib/db";
import { money } from "@/lib/util";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pull sheet" };

/** One pack's pull sheet: number, the 12 cards with prices, and where the physical stack sits. */
export default async function PullSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.gamePack.findUnique({
    where: { id },
    include: { cards: { select: { id: true, game: true, name: true, player: true, setName: true, number: true, year: true, listPrice: true } }, order: { select: { id: true } } },
  });
  if (!p) notFound();
  const byId = new Map(p.cards.map((c) => [c.id, c]));
  const cards = p.cardIds.map((cid) => byId.get(cid)).filter((c): c is NonNullable<typeof c> => !!c);
  const mark = p.kind === "chase" ? "CHASE" : p.kind === "hit" ? "HIT" : p.kind === "member" ? "MEMBER STACK" : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4 print:max-w-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">
            {productName(p.category)} {p.number ?? "?"} {mark && <span className={p.kind === "chase" ? "text-coral" : "text-teal-2"}>· {mark}</span>}
          </h1>
          <p className="text-sm text-navy/70">
            {p.status} · value {money(p.value)} · built {p.builtAt.toLocaleString()}
            {p.order && (
              <>
                {" · "}
                <Link href="/admin/orders" className="underline print:no-underline">
                  in an order
                </Link>
              </>
            )}
          </p>
        </div>
        <PrintButton />
      </div>
      <form action={`/api/admin/game/packs/${p.id}`} method="post" className="flex items-end gap-2 print:hidden">
        <label className="flex-1 text-sm">
          Location note
          <input name="locationNote" defaultValue={p.locationNote ?? ""} placeholder="e.g. Box B, row 3" className="input mt-1 w-full" maxLength={120} />
        </label>
        <button className="btn-ghost">Save</button>
      </form>
      {p.locationNote && <p className="hidden text-sm print:block">Location: {p.locationNote}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy/20 text-left">
            <th className="py-1">#</th>
            <th>Card</th>
            <th>Set</th>
            <th className="text-right">Price</th>
            <th className="w-8 print:table-cell">✓</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c, i) => (
            <tr key={c.id} className={`border-b border-navy/10 ${c.id === p.hitCardId ? "font-bold" : ""}`}>
              <td className="py-1.5">{i + 1}</td>
              <td>
                {(c.game === "Sports" ? c.player || c.name : c.name) || "Unnamed"}
                {c.id === p.hitCardId && <span className="ml-1 text-xs">({mark})</span>}
              </td>
              <td className="text-navy/70">{[c.year, c.setName, c.number].filter(Boolean).join(" ")}</td>
              <td className="text-right">{money(c.listPrice)}</td>
              <td>☐</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-navy/60">Confirm the physical stack matches this sheet before it ships.</p>
    </div>
  );
}
