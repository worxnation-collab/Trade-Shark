"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Progress = { id: string; name: string; priced: number; total: number; line: string };

/**
 * While uploads are processing in the background: keep the work moving (one tick at a time while this page is open;
 * a scheduled function covers it when nobody is looking) and show "4 of 19 priced" per batch. Refreshes the page
 * as cards land in their bins.
 */
export function IngestTicker({ initial, batch }: { initial: Progress[]; batch?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const running = useRef(false);
  useEffect(() => {
    if (!initial.length) return;
    let stop = false;
    let lastPriced = initial.reduce((n, r) => n + r.priced, 0);
    (async () => {
      if (running.current) return;
      running.current = true;
      while (!stop) {
        const r = await fetch(`/api/ingest/tick${batch ? `?batch=${batch}` : ""}`, { method: "POST" })
          .then((x) => (x.ok ? x.json() : null))
          .catch(() => null);
        const p: Progress[] = r?.progress ?? [];
        setRows(p);
        const priced = p.reduce((n, x) => n + x.priced, 0);
        if (priced !== lastPriced || !p.length) {
          lastPriced = priced;
          router.refresh(); // new cards in their bins
        }
        if (!p.length) break;
        if (!r?.units) await new Promise((res) => setTimeout(res, 4000)); // another worker has it, or waiting
      }
      running.current = false;
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.length, batch]);
  if (!rows.length) return null;
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 rounded-lg bg-gold/20 px-3 py-2">
          <span className="h-3 w-3 animate-pulse rounded-full bg-coral" aria-hidden />
          <span className="font-bold">{r.name}:</span>
          <span className="text-lg font-black">{r.line}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-white">
            <span className="block h-full bg-teal" style={{ width: `${r.total ? Math.round((r.priced / r.total) * 100) : 0}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
