"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/util";

interface Row { id: string; label: string; game: string; price: number | null; pairId: string; status: string; listedUrl: string | null; listedChannel: string | null }

export function ExportForm({ ready, awaitingUrl }: { ready: Row[]; awaitingUrl: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(ready.map((r) => r.id)));
  const [mark, setMark] = useState(true);
  const [msg, setMsg] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});

  async function exportCsv(channel: "ebay" | "tcgplayer") {
    const fd = new FormData();
    for (const id of sel) fd.append("ids", id);
    fd.append("markListed", mark ? "1" : "0");
    const res = await fetch(`/api/admin/export/${channel}`, { method: "POST", body: fd });
    if (!res.ok) return setMsg(`Export failed: ${res.statusText}`);
    const blob = await res.blob();
    const name = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `${channel}.csv`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Downloaded ${name}.${mark ? " Exported cards are now Listed — paste live URLs below once published." : ""}`);
    router.refresh();
  }

  async function saveUrl(id: string, channel: string | null) {
    const listedUrl = urls[id];
    if (!listedUrl) return;
    await fetch(`/api/admin/cards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listedUrl, listedChannel: channel ?? "ebay" }) });
    router.refresh();
  }

  const tcgCount = ready.filter((r) => sel.has(r.id) && (r.game === "Pokemon" || r.game === "Magic")).length;
  return (
    <div className="space-y-6">
      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Ready to export ({ready.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Mark exported cards Listed
            </label>
            <button className="btn-primary" disabled={!sel.size} onClick={() => exportCsv("ebay")}>eBay draft CSV ({sel.size})</button>
            <button className="btn-dark" disabled={!tcgCount} onClick={() => exportCsv("tcgplayer")}>TCGplayer CSV ({tcgCount})</button>
          </div>
        </div>
        {msg && <p className="mb-2 rounded bg-teal/10 p-2 text-sm text-teal-2">{msg}</p>}
        {ready.length ? (
          <table className="grid-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={sel.size === ready.length} onChange={(e) => setSel(new Set(e.target.checked ? ready.map((r) => r.id) : []))} /></th>
                <th>Pair</th><th>Card</th><th>Game</th><th className="text-right">List price</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} /></td>
                  <td className="font-mono text-xs">{r.pairId}</td>
                  <td><a className="hover:text-teal" href={`/admin/review/${r.id}?status=Ready`}>{r.label}</a></td>
                  <td>{r.game}</td>
                  <td className="text-right font-semibold">{money(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-navy/60">No Ready cards. Save cards in review to move them to Ready.</p>
        )}
        <p className="mt-3 text-xs text-navy/50">
          eBay file uses Action=Draft: upload it in Seller Hub → Reports → Uploads, then finish and publish the drafts yourself. TCGplayer file includes Pokémon and Magic only.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-bold">Listed, waiting for the live URL ({awaitingUrl.length})</h2>
        {awaitingUrl.length ? (
          <ul className="space-y-2">
            {awaitingUrl.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 font-mono text-xs">{r.pairId}</span>
                <span className="w-72 truncate">{r.label}</span>
                <span className="chip bg-navy/10">{r.listedChannel}</span>
                <input className="input flex-1" placeholder="Paste live listing URL" value={urls[r.id] ?? ""} onChange={(e) => setUrls({ ...urls, [r.id]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveUrl(r.id, r.listedChannel)} />
                <button className="btn-ghost" onClick={() => saveUrl(r.id, r.listedChannel)}>Save</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-navy/60">All listed cards have a URL.</p>
        )}
      </section>
    </div>
  );
}
