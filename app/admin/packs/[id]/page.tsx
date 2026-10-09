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
    include: {
      cards: { select: { id: true, game: true, name: true, player: true, setName: true, number: true, year: true, listPrice: true, location: true, frontImage: true, rotation: true } },
      order: { select: { id: true } },
    },
  });
  if (!p) notFound();
  const byId = new Map(p.cards.map((c) => [c.id, c]));
  // Pull order: by slot code (tray, then number), so one walk down the trays pulls the pack.
  const code = (l: string | null) => {
    const [t, n] = (l ?? "Z-0").split("-");
    return `${t}${String(Number(n) || 0).padStart(5, "0")}`;
  };
  const cards = p.cardIds
    .map((cid) => byId.get(cid))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => code(a.location).localeCompare(code(b.location)));
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
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {cards.map((c) => (
          <li key={c.id} className={`rounded-lg border-2 p-2 text-center ${c.id === p.hitCardId ? "border-coral" : "border-navy/20"}`}>
            <span className="block font-mono text-3xl font-black leading-none">{c.location ?? "—"}</span>
            {c.frontImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/admin/images/${c.frontImage}?r=${c.rotation}`} alt="" className="mx-auto mt-1 h-20 rounded object-contain print:hidden" />
            )}
            <span className="mt-1 block text-xs font-semibold leading-tight">
              {(c.game === "Sports" ? c.player || c.name : c.name) || "Unnamed"}
              {c.id === p.hitCardId && mark ? ` (${mark})` : ""}
            </span>
            <span className="block text-[11px] text-navy/60">
              {money(c.listPrice)} · ☐
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-navy/60">Confirm the physical stack matches this sheet before it ships.</p>
    </div>
  );
}
