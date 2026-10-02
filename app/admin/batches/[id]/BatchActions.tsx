"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BatchActions({ batchId, unprocessed }: { batchId: string; unprocessed: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loop(kind: "process" | "reprice") {
    setBusy(true);
    try {
      if (kind === "process") {
        let remaining = unprocessed;
        while (remaining > 0) {
          setMsg(`Identifying + pricing… ${remaining} left`);
          const r = await (await fetch(`/api/admin/batches/${batchId}/process?limit=6`, { method: "POST" })).json();
          if (r.error) throw new Error(r.error);
          remaining = r.remaining;
          if (!r.processed) break;
        }
      } else {
        let cursor = 0;
        for (;;) {
          const r = await (await fetch(`/api/admin/batches/${batchId}/reprice?cursor=${cursor}`, { method: "POST" })).json();
          if (r.error) throw new Error(r.error);
          setMsg(`Repricing stale quotes… ${r.next}/${r.total}`);
          cursor = r.next;
          if (r.done) break;
        }
      }
      setMsg("Done.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unprocessed > 0 && (
        <button className="btn-primary" disabled={busy} onClick={() => loop("process")}>
          Identify + price {unprocessed} card(s)
        </button>
      )}
      <button className="btn-ghost" disabled={busy} onClick={() => loop("reprice")} title="Refresh quotes older than the stale window">
        ↻ Reprice batch
      </button>
      {msg && <span className="text-sm text-navy/60">{msg}</span>}
    </div>
  );
}
