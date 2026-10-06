import { accountStatus, partnerSummary, recordMissingSales } from "@/lib/partners";
import { KEEP_SPLIT_INCLUDES_REVEAL } from "@/lib/partners/split";
import { db } from "@/lib/db";
import { money } from "@/lib/util";
import { PartnerActions } from "./PartnerActions";

export const metadata = { title: "Partners" };
export const dynamic = "force-dynamic";

/** Who owns what, and who's owed what. Payouts are by hand only. */
export default async function PartnersPage() {
  await recordMissingSales().catch((e) => console.error("catch-up split failed", e));
  const rows = await partnerSummary();
  const status = await Promise.all(rows.map((r) => (r.stripeAccountId ? accountStatus(r.stripeAccountId) : null)));
  const untagged = await db.card.count({ where: { partnerId: null, status: { in: ["Inbox", "Identified", "Priced", "BulkHold", "NeedsLook"] } } });
  const recent = await db.partnerEarning.findMany({ orderBy: { createdAt: "desc" }, take: 15 });
  const packs = new Map((await db.gamePack.findMany({ where: { id: { in: recent.map((e) => e.packId) } }, select: { id: true, number: true, category: true } })).map((p) => [p.id, p]));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Partners</h1>
        <p className="text-sm text-navy/70">
          A sold pack (keep {KEEP_SPLIT_INCLUDES_REVEAL ? "$3.99" : "$2.99"} or blind $4.99) minus its Stripe fee, split by each partner&apos;s share of the stack&apos;s engine value.
          {KEEP_SPLIT_INCLUDES_REVEAL ? " An unkept $1 peek" : " Every $1 peek"} and all shipping stay with the shop. Cards still in stock earn nothing. Payouts are manual transfers to each
          partner&apos;s connected Stripe account.
        </p>
        {untagged > 0 && <p className="mt-2 rounded bg-coral/10 p-2 text-sm text-coral">{untagged} card(s) in stock have no partner and can&apos;t go in a pack. Tag them on their batch page.</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {rows.map((r, i) => {
          const st = status[i];
          return (
            <div key={r.id} className="card space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-bold">{r.name}</h2>
                <span className="text-2xl font-extrabold text-teal-2">{money(r.owed)}</span>
              </div>
              <p className="-mt-2 text-right text-xs text-navy/60">owed</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-navy/60">Cards uploaded</dt>
                <dd className="text-right font-semibold">{r.uploaded}</dd>
                <dt className="text-navy/60">In ready stacks</dt>
                <dd className="text-right font-semibold">
                  {money(r.readyValue)} <span className="text-xs font-normal text-navy/50">({r.readyCards})</span>
                </dd>
                <dt className="text-navy/60">Loose in stock</dt>
                <dd className="text-right">
                  {money(r.looseValue)} <span className="text-xs text-navy/50">({r.looseCards})</span>
                </dd>
                <dt className="text-navy/60">Value sold</dt>
                <dd className="text-right font-semibold">
                  {money(r.soldValue)} <span className="text-xs font-normal text-navy/50">({r.packsSold} packs)</span>
                </dd>
                <dt className="text-navy/60">Earned</dt>
                <dd className="text-right">{money(r.earned)}</dd>
                <dt className="text-navy/60">Paid</dt>
                <dd className="text-right">{money(r.paid)}</dd>
              </dl>
              <div className="text-xs text-navy/60">
                {r.stripeAccountId ? (
                  <>
                    Stripe <code>{r.stripeAccountId}</code>{" "}
                    {st && "error" in st ? <span className="text-coral">{st.error}</span> : st ? (st.transfers === "active" ? "· ready for transfers" : `· transfers ${st.transfers}${st.detailsSubmitted ? "" : ", onboarding not finished"}`) : null}
                  </>
                ) : (
                  "No connected Stripe account yet."
                )}
              </div>
              <PartnerActions id={r.id} name={r.name} owed={r.owed} accountId={r.stripeAccountId} />
              {r.payouts.length > 0 && (
                <ul className="space-y-0.5 border-t border-navy/10 pt-2 text-xs text-navy/70">
                  {r.payouts.map((p) => (
                    <li key={p.id}>
                      {p.createdAt.toLocaleDateString()} · {money(p.amount)} · {p.status === "paid" ? `paid (${p.transferId})` : p.status === "failed" ? <span className="text-coral">failed: {p.error}</span> : "pending"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <section className="card p-4">
        <h2 className="font-bold">Recent splits</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-navy/60">No sold packs since partners were added.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-navy/60">
              <tr>
                <th>Pack</th>
                <th>Partner</th>
                <th className="text-right">Price</th>
                <th className="text-right">Fee</th>
                <th className="text-right">Net</th>
                <th className="text-right">Their value</th>
                <th className="text-right">Owed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => {
                const p = packs.get(e.packId);
                return (
                  <tr key={e.id} className="border-t border-navy/5">
                    <td>
                      <a href={`/admin/packs/${e.packId}`} className="hover:text-teal-2">
                        {p ? `${p.category} ${p.number ?? ""}` : e.packId}
                      </a>{" "}
                      <span className="text-xs text-navy/50">{e.saleKind === "kept" ? "keep" : "blind"}</span>
                    </td>
                    <td>{rows.find((r) => r.id === e.partnerId)?.name ?? e.partnerId}</td>
                    <td className="text-right">{money(e.packPrice)}</td>
                    <td className="text-right">
                      {money(e.stripeFee)}
                      {e.feeEstimated && <span title="Estimated: Stripe didn't report the fee">*</span>}
                    </td>
                    <td className="text-right">{money(e.net)}</td>
                    <td className="text-right">
                      {money(e.cardValue)} / {money(e.packValue)}
                    </td>
                    <td className="text-right font-semibold">{money(e.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
