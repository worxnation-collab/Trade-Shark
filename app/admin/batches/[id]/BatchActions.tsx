"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { confetti } from "@/lib/client/feel";

export function BatchActions({ batchId, unprocessed }: { batchId: string; unprocessed: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // A fresh upload runs straight through: identify, price, publish. No button to press.
  useEffect(() => {
    if (started.current || unprocessed <= 0) return;
    started.current = true;
    void loop("process");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loop(kind: "process" | "reprice") {
    setBusy(true);
    try {
      if (kind === "process") {
        let remaining = unprocessed;
        const tally: Record<string, number> = {};
        const line = () =>
          [
            tally.publish && `${tally.publish} live`,
            tally.stack && `${tally.stack} for Lil' Stacks`,
            tally.review && `${tally.review} need a look`,
            tally.hold && `${tally.hold} held (no name)`,
          ]
            .filter(Boolean)
            .join(" · ");
        let misses = 0;
        while (remaining > 0) {
          setMsg(`Identifying, pricing and publishing… ${remaining} left${line() ? ` · ${line()}` : ""}`);
          // A slow card can time out a request; the card stays unprocessed, so just ask again (a few times).
          const r = await fetch(`/api/admin/batches/${batchId}/process?limit=1`, { method: "POST" })
            .then((res) => res.json())
            .catch(() => null);
          if (!r || r.error) {
            if (++misses >= 4) throw new Error(r?.error ?? "The server kept timing out. Reload this page to pick up where it stopped.");
            continue;
          }
          misses = 0;
          for (const d of (r.decisions ?? []) as string[]) tally[d] = (tally[d] ?? 0) + 1;
          remaining = r.remaining;
          if (!r.processed) break;
        }
        if (tally.publish || tally.stack) confetti(null);
        setMsg(`Done! ${line() || "Nothing new to publish."}`);
        router.refresh();
        return;
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
          Identify + price + publish {unprocessed} card(s)
        </button>
      )}
      <button className="btn-ghost" disabled={busy} onClick={() => loop("reprice")} title="Refresh quotes older than the stale window">
        ↻ Reprice batch
      </button>
      {msg && <span className="text-sm text-navy/60">{msg}</span>}
    </div>
  );
}
