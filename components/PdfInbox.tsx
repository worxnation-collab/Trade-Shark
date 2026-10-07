"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { queueBatch, uploadPdf } from "@/lib/client/upload";

/**
 * PDFs sent by the Drive script wait here (the server can't split a PDF). While the desk is open, this splits each one
 * in the browser, the same way the upload form does, then hands the batch to the background queue.
 */
export function PdfInbox({ pdfjsVersion, cvSrc }: { pdfjsVersion: string; cvSrc: string }) {
  const router = useRouter();
  const [line, setLine] = useState("");
  const busy = useRef(false);
  useEffect(() => {
    let stop = false;
    const run = async () => {
      if (busy.current || stop) return;
      busy.current = true;
      try {
        const r = await fetch("/api/admin/pdf-inbox").then((x) => (x.ok ? x.json() : null)).catch(() => null);
        for (const p of (r?.pdfs ?? []) as { id: string; batchId: string; name: string; url: string | null }[]) {
          if (stop || !p.url) continue;
          setLine(`From Drive: ${p.name}, downloading…`);
          const blob = await fetch(p.url).then((x) => (x.ok ? x.blob() : null)).catch(() => null);
          if (!blob) continue;
          const file = new File([blob], p.name, { type: "application/pdf" });
          const done = await uploadPdf(p.batchId, file, { pdfjsVersion, cvSrc, onPage: (page, pages) => setLine(`From Drive: ${p.name}, page ${page} of ${pages}`) }).catch(() => null);
          if (done && !done.skipped) {
            const q = await queueBatch(p.batchId, { pairMode: "auto" }).catch(() => null);
            setLine(`From Drive: ${p.name}. ${q?.message ?? ""}`);
            router.refresh();
          }
        }
      } finally {
        busy.current = false;
      }
    };
    void run();
    const t = window.setInterval(run, 60_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [pdfjsVersion, cvSrc, router]);
  return line ? <p className="text-sm font-semibold">{line}</p> : null;
}
