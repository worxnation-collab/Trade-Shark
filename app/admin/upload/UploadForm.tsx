"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { SharkFin } from "@/components/SharkFin";
import { createBatch, organize, processAll, uploadItems } from "@/lib/client/upload";

type Picked = { file: File; path: string };

const IMG_RE = /\.(jpe?g|png|webp|gif|tiff?|heic|heif)$/i;

async function walkEntry(entry: FileSystemEntry, prefix = ""): Promise<Picked[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ file, path: prefix + file.name }];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const all: FileSystemEntry[] = [];
    // readEntries returns chunks of ~100; keep reading until empty.
    for (;;) {
      const chunk = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!chunk.length) break;
      all.push(...chunk);
    }
    const nested = await Promise.all(all.map((e) => walkEntry(e, `${prefix}${entry.name}/`)));
    return nested.flat();
  }
  return [];
}

export function UploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<Picked[]>([]);
  const [manifest, setManifest] = useState("");
  const [manifestName, setManifestName] = useState("");
  const [lines, setLines] = useState("");
  const [pairMode, setPairMode] = useState("auto");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  async function addPicked(picked: Picked[]) {
    const csv = picked.find((p) => /\.csv$/i.test(p.path));
    if (csv && !manifest) {
      setManifest(await csv.file.text());
      setManifestName(csv.path);
    }
    // Keep everything that isn't the manifest or OS junk; non-images go to the Unreadable pile, not the bin.
    const keep = picked.filter((p) => !/\.csv$/i.test(p.path) && !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(p.path) && !/(^|\/)\./.test(p.path));
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => p.path));
      return [...prev, ...keep.filter((p) => !seen.has(p.path))];
    });
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const items = [...e.dataTransfer.items];
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (entries.length) addPicked((await Promise.all(entries.map((en) => walkEntry(en)))).flat());
    else addPicked([...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
  }

  function onPick(list: FileList | null) {
    if (!list) return;
    addPicked([...list].map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name })));
  }

  async function submit() {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const id = await createBatch(name);
      await uploadItems(
        id,
        files.map((p) => ({ file: p.file, name: p.path })),
        (done, total) => setProgress({ label: "Uploading", done, total }),
      );
      setProgress({ label: "Pairing + deduping", done: files.length, total: files.length });
      const org = await organize(id, { pairMode, manifest, pastedLines: lines });
      await processAll(id, org.cards, (done, total) => setProgress({ label: "Identifying + pricing", done, total }));
      router.push(`/admin/batches/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const images = files.filter((f) => IMG_RE.test(f.path)).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`card flex flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-14 text-center ${over ? "border-teal bg-teal/5" : "border-navy/20"}`}
        >
          <SharkFin size={52} />
          <div className="text-lg font-bold">Drop a folder or a pile of scans</div>
          <div className="text-sm text-navy/60">Fronts + backs, phone shots, a CSV manifest — all at once is fine.</div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => fileInput.current?.click()}>Choose files</button>
            <button type="button" className="btn-ghost" onClick={() => dirInput.current?.click()}>Choose folder</button>
          </div>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
          <input
            ref={dirInput}
            type="file"
            multiple
            hidden
            onChange={(e) => onPick(e.target.files)}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          />
        </div>
        {files.length > 0 && (
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">
                {files.length} file(s) · {images} image(s){files.length - images > 0 && <span className="text-coral"> · {files.length - images} non-image → Unreadable pile</span>}
              </span>
              <button className="text-xs font-semibold text-coral" onClick={() => setFiles([])} disabled={busy}>Clear</button>
            </div>
            <ul className="max-h-60 overflow-auto font-mono text-xs text-navy/70">
              {files.slice(0, 400).map((f) => (
                <li key={f.path}>{f.path}</li>
              ))}
              {files.length > 400 && <li>… and {files.length - 400} more</li>}
            </ul>
          </div>
        )}
      </div>

      <div className="card space-y-4 p-4">
        <div>
          <label className="label">Batch name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Estate sale binder #2" />
        </div>
        <div>
          <label className="label">Pair fronts & backs</label>
          <select className="input" value={pairMode} onChange={(e) => setPairMode(e.target.value)}>
            <option value="auto">Auto — filename tokens, then front-then-back order</option>
            <option value="filename">Filename tokens only (-front/-back, _f/_b)</option>
            <option value="order">Front-then-back order (ignore names)</option>
            <option value="fronts">Fronts only — no backs</option>
          </select>
        </div>
        <div>
          <label className="label">CSV manifest (optional)</label>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setManifest(await f.text());
                setManifestName(f.name);
              }
            }}
          />
          {manifestName && <div className="mt-1 text-xs text-teal-2">Using {manifestName}</div>}
          <p className="mt-1 text-xs text-navy/50">Columns like filename, back, name, set, number, year, variant, game, condition, cost, qty, notes. Matched by filename, else by order.</p>
        </div>
        <div>
          <label className="label">Pasted lines (optional, one per card in order)</label>
          <textarea className="input h-28 font-mono text-xs" value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"1999 Base Set 4/102 Charizard Holo\n2018 Topps Chrome Shohei Ohtani #150 RC"} />
        </div>
        {error && <p className="rounded bg-coral/10 p-2 text-sm text-coral">{error}</p>}
        {progress && (
          <div>
            <div className="mb-1 flex justify-between text-xs font-semibold">
              <span>{progress.label}…</span>
              <span>
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-sand-2">
              <div className="h-full bg-teal transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
            </div>
          </div>
        )}
        <button className="btn-primary w-full justify-center py-2.5 text-base" disabled={busy || !files.length} onClick={submit}>
          {busy ? "Working…" : `Organize + price ${files.length || ""} file(s)`}
        </button>
        <p className="text-xs text-navy/50">Nothing is listed anywhere. Every card waits for your review.</p>
      </div>
    </div>
  );
}
