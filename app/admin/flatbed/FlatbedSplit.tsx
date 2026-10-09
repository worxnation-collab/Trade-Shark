"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SharkFin } from "@/components/SharkFin";
import { OwnerSelect } from "@/components/PartnerSelect";
import { createBatch, queueBatch, uploadItems, type UploadItem } from "@/lib/client/upload";
import { cropCard, detectCards, manualBox } from "@/lib/flatbed/detect";
import { readDpi } from "@/lib/flatbed/dpi";
import { CARD_RATIO, type CardBox, center, checkSheetPairing, cropName, type Pt, quadSize, readingOrder } from "@/lib/flatbed/geometry";
import { cvReady } from "@/lib/flatbed/loadCv";

type Side = "front" | "back";

interface Sheet {
  file: File;
  dpi?: number;
  width: number;
  height: number;
  preview: string; // downscaled data URL for display
  boxes: CardBox[];
  thumbs: Record<string, string>;
}

const PREVIEW_MAX = 1400;
const THUMB_MAX = 240;

function useOpenCv(src: string) {
  const [cv, setCv] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const w = window as any;
    if (w.__tsCv) {
      cvReady(w.__tsCv).then(setCv);
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      w.__tsCv = w.cv;
      cvReady(w.cv).then(setCv);
    };
    s.onerror = () => setErr("Couldn't load OpenCV. Check your connection and reload.");
    document.body.appendChild(s);
  }, [src]);
  return { cv, err };
}

async function loadMat(cv: any, file: File) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const mat = cv.matFromImageData(ctx.getImageData(0, 0, bmp.width, bmp.height));
  const s = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
  const pc = document.createElement("canvas");
  pc.width = Math.round(bmp.width * s);
  pc.height = Math.round(bmp.height * s);
  pc.getContext("2d")!.drawImage(bmp, 0, 0, pc.width, pc.height);
  bmp.close();
  return { mat, width: canvas.width, height: canvas.height, preview: pc.toDataURL("image/jpeg", 0.85) };
}

function matToCanvas(cv: any, mat: any) {
  const c = document.createElement("canvas");
  cv.imshow(c, mat);
  return c;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "batch";

export function FlatbedSplit({ cvSrc, batchId, batchName, startAt }: { cvSrc: string; batchId?: string; batchName?: string; startAt: number }) {
  const router = useRouter();
  const { cv, err: cvErr } = useOpenCv(cvSrc);
  const mats = useRef<Partial<Record<Side, any>>>({});
  const [sheets, setSheets] = useState<Partial<Record<Side, Sheet>>>({});
  const [tab, setTab] = useState<Side>("front");
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [margin, setMargin] = useState(2.5);
  const [prefix, setPrefix] = useState("batch");
  const [name, setName] = useState("");
  const [partner, setPartner] = useState("");
  const [frontsOnly, setFrontsOnly] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);

  useEffect(() => () => Object.values(mats.current).forEach((m) => m?.delete()), []);

  const sheet = sheets[tab];

  async function pick(side: Side, file: File | undefined) {
    if (!file || !cv) return;
    setError("");
    if (!/^image\/(jpeg|png)$/.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) {
      setError("Flatbed sheets must be JPEG or PNG.");
      return;
    }
    setBusy(`Detecting cards on the ${side} sheet…`);
    try {
      const dpi = readDpi(await file.arrayBuffer());
      const { mat, width, height, preview } = await loadMat(cv, file);
      mats.current[side]?.delete();
      mats.current[side] = mat;
      // Crops go up as scanned; the server stands every card upright on its own (lib/orient.ts).
      const boxes = detectCards(cv, mat, { dpi }).map((b) => ({ ...b, rotation: 0 as CardBox["rotation"] }));
      setSheets((s) => ({ ...s, [side]: { file, dpi, width, height, preview, boxes, thumbs: {} } }));
      setTab(side);
      setSelected(null);
    } catch (e) {
      setError(`Couldn't read that image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  const setBoxes = useCallback((side: Side, fn: (b: CardBox[]) => CardBox[]) => {
    setSheets((s) => {
      const sh = s[side];
      if (!sh) return s;
      return { ...s, [side]: { ...sh, boxes: readingOrder(fn(sh.boxes)) } };
    });
  }, []);

  // Live crop previews (small) whenever boxes or margin change.
  const thumbKey = useMemo(
    () => JSON.stringify(Object.entries(sheets).map(([k, v]) => [k, v?.boxes.map((b) => [b.corners, b.rotation])])) + margin,
    [sheets, margin],
  );
  useEffect(() => {
    if (!cv) return;
    const t = setTimeout(() => {
      setSheets((s) => {
        const next = { ...s };
        for (const side of ["front", "back"] as Side[]) {
          const sh = s[side];
          const mat = mats.current[side];
          if (!sh || !mat) continue;
          const thumbs: Record<string, string> = {};
          for (const b of sh.boxes) {
            const crop = cropCard(cv, mat, b, margin / 100, THUMB_MAX);
            thumbs[b.id] = matToCanvas(cv, crop).toDataURL("image/jpeg", 0.8);
            crop.delete();
          }
          next[side] = { ...sh, thumbs };
        }
        return next;
      });
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv, thumbKey]);

  // Keyboard: Delete removes the selected box, R rotates it, A toggles add mode, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setBoxes(tab, (bs) => bs.filter((b) => b.id !== selected));
        setSelected(null);
      } else if ((e.key === "r" || e.key === "R") && selected) {
        setBoxes(tab, (bs) => bs.map((b) => (b.id === selected ? { ...b, rotation: (((b.rotation + 90) % 360) as CardBox["rotation"]) } : b)));
      } else if (e.key === "a" || e.key === "A") setAddMode((x) => !x);
      else if (e.key === "Escape") {
        setSelected(null);
        setAddMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, tab, setBoxes]);

  const pairing = sheets.front && sheets.back ? checkSheetPairing(sheets.front.boxes, sheets.back.boxes) : null;
  const canCommit =
    !!sheets.front?.boxes.length && !busy && (!sheets.back || pairing?.ok || frontsOnly);

  async function commit() {
    if (!cv || !sheets.front) return;
    setBusy("Cropping + uploading…");
    setError("");
    try {
      const id = batchId ?? (await createBatch(name || `Flatbed ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`, partner));
      const useBack = !!sheets.back && pairing?.ok && !frontsOnly;
      const sides: Side[] = useBack ? ["front", "back"] : ["front"];

      // 1) Keep the original sheets (never become cards).
      setProgress({ label: "Uploading sheets", done: 0, total: sides.length });
      const sheetItems: UploadItem[] = sides.map((side) => ({
        file: sheets[side]!.file,
        name: `sheets/${sheets[side]!.file.name}`,
        meta: { kind: "sheet", side },
      }));
      const reg = await uploadItems(id, sheetItems);
      const sheetRef: Partial<Record<Side, { rel: string; hash: string; name: string }>> = {};
      sides.forEach((side, i) => (sheetRef[side] = { rel: reg[i]?.rel, hash: reg[i]?.hash, name: sheets[side]!.file.name }));

      // 2) Full-resolution perspective crops, reading order, numbered from startAt.
      const session = `fb${Date.now().toString(36)}`;
      const items: UploadItem[] = [];
      const p = slug(prefix);
      for (const side of sides) {
        const sh = sheets[side]!;
        for (let i = 0; i < sh.boxes.length; i++) {
          setProgress({ label: `Cropping ${side}`, done: i, total: sh.boxes.length });
          const n = startAt + i;
          const crop = cropCard(cv, mats.current[side], sh.boxes[i], margin / 100);
          const blob: Blob = await new Promise((res, rej) =>
            matToCanvas(cv, crop).toBlob((b) => (b ? res(b) : rej(new Error("JPEG encode failed"))), "image/jpeg", 0.92),
          );
          crop.delete();
          items.push({
            file: blob,
            name: cropName(p, n, side),
            meta: {
              kind: "crop",
              pairKey: `${session}-${String(n).padStart(3, "0")}`,
              side,
              sheetName: sheetRef[side]?.name,
              sheetRel: sheetRef[side]?.rel,
              sheetHash: sheetRef[side]?.hash,
              cropIndex: i + 1,
              cropBox: sh.boxes[i].corners.map((c) => [Math.round(c.x), Math.round(c.y)]),
            },
          });
        }
      }
      await uploadItems(id, items, (done, total) => setProgress({ label: "Uploading crops", done, total }));

      // 3) Same pipeline as feeder scans from here on.
      setProgress({ label: "Pairing + deduping", done: 0, total: 1 });
      const q = await queueBatch(id, { pairMode: "auto" });
      router.push(`/admin/lil-stack?received=${encodeURIComponent(q.message)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      {cvErr && <p className="rounded bg-coral/10 p-2 text-sm text-coral">{cvErr}</p>}
      {!cv && !cvErr && <p className="text-sm text-navy/60">Loading OpenCV…</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["front", "back"] as Side[]).map((side) => (
              <button
                key={side}
                onClick={() => sheets[side] && setTab(side)}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${tab === side ? "bg-navy text-white" : "bg-white text-navy"}`}
              >
                {side === "front" ? "Front sheet" : "Back sheet"}
                {sheets[side] && <span className="ml-1 opacity-70">{sheets[side]!.boxes.length}</span>}
              </button>
            ))}
            <label className="btn-ghost cursor-pointer">
              {sheets.front ? "Replace front" : "Choose front sheet"}
              <input type="file" accept="image/jpeg,image/png" hidden disabled={!cv} onChange={(e) => pick("front", e.target.files?.[0])} />
            </label>
            <label className={`btn-ghost cursor-pointer ${!sheets.front ? "opacity-50" : ""}`}>
              {sheets.back ? "Replace back" : "Add back sheet (optional)"}
              <input type="file" accept="image/jpeg,image/png" hidden disabled={!cv || !sheets.front} onChange={(e) => pick("back", e.target.files?.[0])} />
            </label>
          </div>

          {sheet ? (
            <SheetEditor
              sheet={sheet}
              selected={selected}
              addMode={addMode}
              onSelect={setSelected}
              onChange={(fn) => setBoxes(tab, fn)}
              onAdded={() => setAddMode(false)}
            />
          ) : (
            <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
              <SharkFin size={52} />
              <div className="text-lg font-bold">Drop a copier scan of several cards</div>
              <p className="max-w-md text-sm text-navy/60">
                JPEG or PNG, light or dark lid. Leave a little gap between cards. For backs, flip each card in place and scan again so
                crop 1 lines up with crop 1.
              </p>
            </div>
          )}
        </div>

        <aside className="card space-y-4 p-4">
          {sheet && (
            <div className="space-y-2 text-sm">
              <div className="font-bold">Boxes ({sheet.boxes.length})</div>
              <div className="flex flex-wrap gap-2">
                <button className={addMode ? "btn-coral" : "btn-ghost"} onClick={() => setAddMode((x) => !x)}>
                  {addMode ? "Drawing… (Esc)" : "+ Add missed card"}
                </button>
                <button className="btn-ghost text-coral" disabled={!selected} onClick={() => { setBoxes(tab, (bs) => bs.filter((b) => b.id !== selected)); setSelected(null); }}>
                  Delete box
                </button>
              </div>
              <details className="text-xs text-navy/60">
                <summary className="cursor-pointer select-none">Fallback: turn crops by hand</summary>
                <p className="mt-1">Not needed normally: every card is stood upright automatically after upload.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-ghost" disabled={!selected} onClick={() => selected && setBoxes(tab, (bs) => bs.map((b) => (b.id === selected ? { ...b, rotation: (((b.rotation + 90) % 360) as CardBox["rotation"]) } : b)))}>
                  ↻ Rotate
                </button>
                <button
                  className="btn-ghost"
                  title="Turn every crop on this sheet 90°"
                  onClick={() => {
                    let next = 0;
                    setBoxes(tab, (bs) => {
                      next = ((bs[0]?.rotation ?? 0) + 90) % 360;
                      return bs.map((b) => ({ ...b, rotation: next as CardBox["rotation"] }));
                    });
                  }}
                >
                  ↻ Rotate all
                </button>
                </div>
              </details>
              <p className="text-xs text-navy/50">
                Click a box to select it, drag its corners to adjust. <kbd>Del</kbd> delete · <kbd>R</kbd> rotate · <kbd>A</kbd> add (drag a rectangle, or
                click once for a card-size box).
              </p>
              {sheet.boxes.some((b) => b.source === "split") && (
                <p className="rounded bg-coral/10 p-2 text-xs text-coral">
                  Some cards were touching, so their shared edge is estimated (dashed coral). Drag those corners to the true edges, or leave a gap
                  between cards next time.
                </p>
              )}
              <div className="text-xs text-navy/50">
                {sheet.width}×{sheet.height}px{sheet.dpi ? ` · ${sheet.dpi} dpi` : " · dpi unknown"}
              </div>
            </div>
          )}

          {sheets.front && sheets.back && pairing && (
            <div className={`rounded-md p-2 text-sm ${pairing.ok ? "bg-teal/10 text-teal-2" : "bg-coral/10 text-coral"}`}>
              {pairing.ok ? (
                <>Pairing by position: front 1 ↔ back 1 … front {pairing.count} ↔ back {pairing.count}.</>
              ) : (
                <>
                  <div className="font-semibold">Won&apos;t pair: {pairing.reason}</div>
                  <div className="mt-1 text-xs">Fix the boxes until both sheets match, or commit fronts only. Pairs are never guessed across different layouts.</div>
                  <label className="mt-2 flex items-center gap-2 text-xs text-navy">
                    <input type="checkbox" checked={frontsOnly} onChange={(e) => setFrontsOnly(e.target.checked)} /> Commit fronts only (ignore the back sheet)
                  </label>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {!batchId && (
              <div className="col-span-2">
                <label className="label">Whose cards? Founder or sender (required)</label>
                <OwnerSelect value={partner} onChange={setPartner} />
              </div>
            )}
            {!batchId && (
              <div className="col-span-2">
                <label className="label">Batch name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Binder page 3" />
              </div>
            )}
            <div>
              <label className="label">File prefix</label>
              <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>
            <div>
              <label className="label">Margin {margin}%</label>
              <input type="range" min={0} max={6} step={0.5} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full" />
            </div>
            <div className="col-span-2 text-xs text-navy/50">
              Saves as {cropName(slug(prefix), startAt, "front")}
              {sheets.back && !frontsOnly ? `, ${cropName(slug(prefix), startAt, "back")}` : ""} …
              {batchId && <> · adding to <b>{batchName}</b></>}
            </div>
          </div>

          {error && <p className="rounded bg-coral/10 p-2 text-sm text-coral">{error}</p>}
          {(busy || progress) && (
            <div>
              <div className="mb-1 flex justify-between text-xs font-semibold">
                <span>{progress?.label ?? busy}</span>
                {progress && <span>{progress.done}/{progress.total}</span>}
              </div>
              <div className="h-2 overflow-hidden rounded bg-sand-2">
                <div className="h-full bg-teal transition-all" style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 30}%` }} />
              </div>
            </div>
          )}
          <button className="btn-primary w-full justify-center py-2.5 text-base" disabled={!canCommit || (!batchId && !partner)} onClick={commit}>
            Commit {sheets.front?.boxes.length ?? 0} card(s) to Inbox
          </button>
          <p className="text-xs text-navy/50">Crops are cut in your browser with OpenCV. Nothing is sent to a vision API to split the sheet.</p>
        </aside>
      </div>

      {(["front", "back"] as Side[]).map((side) =>
        sheets[side]?.boxes.length ? (
          <section key={side} className="card p-3">
            <div className="mb-2 text-sm font-bold">{side === "front" ? "Front crops" : "Back crops"}</div>
            <div className="flex flex-wrap gap-3">
              {sheets[side]!.boxes.map((b, i) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setTab(side);
                    setSelected(b.id);
                  }}
                  className={`w-28 rounded border p-1 text-center ${selected === b.id && tab === side ? "border-coral" : "border-navy/10"}`}
                >
                  {sheets[side]!.thumbs[b.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sheets[side]!.thumbs[b.id]} alt="" className="mx-auto h-36 object-contain" />
                  ) : (
                    <div className="h-36" />
                  )}
                  <div className="truncate font-mono text-[10px]">{cropName(slug(prefix), startAt + i, side)}</div>
                  {b.source === "manual" && <div className="text-[10px] text-coral">added</div>}
                  {b.source === "split" && <div className="text-[10px] text-coral">touching: check</div>}
                </button>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

/** Sheet preview with an SVG overlay in full-resolution sheet coordinates. */
function SheetEditor({
  sheet,
  selected,
  addMode,
  onSelect,
  onChange,
  onAdded,
}: {
  sheet: Sheet;
  selected: string | null;
  addMode: boolean;
  onSelect: (id: string | null) => void;
  onChange: (fn: (b: CardBox[]) => CardBox[]) => void;
  onAdded: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ kind: "new"; start: Pt; now: Pt } | { kind: "corner"; id: string; corner: number } | null>(null);
  const stroke = Math.max(sheet.width, sheet.height) / 400;

  const toSheet = (e: React.PointerEvent): Pt => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: Math.max(0, Math.min(sheet.width, p.x)), y: Math.max(0, Math.min(sheet.height, p.y)) };
  };

  // A typical card size on this sheet: from existing boxes, else DPI, else a letter-glass guess.
  const cardSize = () => {
    if (sheet.boxes.length) {
      const s = sheet.boxes.map((b) => quadSize(b.corners)).map(({ w, h }) => Math.min(w, h)).sort((a, b) => a - b);
      const short = s[Math.floor(s.length / 2)];
      return { w: short, h: short / CARD_RATIO };
    }
    const d = sheet.dpi ?? Math.max(sheet.width, sheet.height) / 11.35;
    return { w: 2.5 * d, h: 3.5 * d };
  };

  return (
    <div className="card overflow-hidden bg-navy/5 p-2">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sheet.preview} alt="sheet" className="block w-full select-none" draggable={false} />
        <svg
          ref={svg}
          viewBox={`0 0 ${sheet.width} ${sheet.height}`}
          className={`absolute inset-0 h-full w-full ${addMode ? "cursor-crosshair" : ""}`}
          onPointerDown={(e) => {
            if (!addMode) {
              if (e.target === svg.current) onSelect(null);
              return;
            }
            (e.target as Element).setPointerCapture?.(e.pointerId);
            const p = toSheet(e);
            setDrag({ kind: "new", start: p, now: p });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = toSheet(e);
            if (drag.kind === "new") setDrag({ ...drag, now: p });
            else
              onChange((bs) =>
                bs.map((b) => (b.id === drag.id ? { ...b, source: "manual", corners: b.corners.map((c, i) => (i === drag.corner ? p : c)) as CardBox["corners"] } : b)),
              );
          }}
          onPointerUp={() => {
            if (drag?.kind === "new") {
              const { start, now } = drag;
              let box: CardBox;
              if (Math.abs(now.x - start.x) < stroke * 6 && Math.abs(now.y - start.y) < stroke * 6) {
                const { w, h } = cardSize();
                box = manualBox(start.x - w / 2, start.y - h / 2, start.x + w / 2, start.y + h / 2);
              } else box = manualBox(start.x, start.y, now.x, now.y);
              onChange((bs) => [...bs, box]);
              onSelect(box.id);
              onAdded();
            }
            setDrag(null);
          }}
        >
          {sheet.boxes.map((b, i) => {
            const sel = b.id === selected;
            const c = center(b.corners);
            return (
              <g key={b.id} onPointerDown={(e) => { if (!addMode) { e.stopPropagation(); onSelect(b.id); } }} className="cursor-pointer">
                <polygon
                  points={b.corners.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={sel ? "rgba(232,93,76,0.15)" : "rgba(26,166,166,0.10)"}
                  stroke={sel || b.source === "split" ? "#E85D4C" : b.source === "manual" ? "#0B1F3A" : "#1AA6A6"}
                  strokeWidth={stroke * (sel ? 1.6 : 1)}
                  strokeDasharray={b.source !== "auto" ? `${stroke * 4} ${stroke * 3}` : undefined}
                />
                <circle cx={c.x} cy={c.y} r={stroke * 14} fill={sel ? "#E85D4C" : "#0B1F3A"} />
                <text x={c.x} y={c.y} fill="#fff" fontSize={stroke * 16} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                  {i + 1}
                </text>
                {b.source === "split" && (
                  <text x={c.x} y={c.y - stroke * 26} fill="#E85D4C" fontSize={stroke * 11} fontWeight={700} textAnchor="middle">
                    touching: check edges
                  </text>
                )}
                {b.rotation !== 0 && (
                  <text x={c.x} y={c.y + stroke * 28} fill="#0B1F3A" fontSize={stroke * 10} textAnchor="middle">
                    ↻{b.rotation}°
                  </text>
                )}
                {sel &&
                  b.corners.map((p, k) => (
                    <circle
                      key={k}
                      cx={p.x}
                      cy={p.y}
                      r={stroke * 7}
                      fill="#fff"
                      stroke="#E85D4C"
                      strokeWidth={stroke * 1.5}
                      className="cursor-move"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        setDrag({ kind: "corner", id: b.id, corner: k });
                      }}
                    />
                  ))}
              </g>
            );
          })}
          {drag?.kind === "new" && (
            <rect
              x={Math.min(drag.start.x, drag.now.x)}
              y={Math.min(drag.start.y, drag.now.y)}
              width={Math.abs(drag.now.x - drag.start.x)}
              height={Math.abs(drag.now.y - drag.start.y)}
              fill="rgba(232,93,76,0.1)"
              stroke="#E85D4C"
              strokeWidth={stroke}
            />
          )}
        </svg>
      </div>
      {!sheet.boxes.length && <p className="p-2 text-sm text-coral">No cards found. Use “Add missed card” to draw them.</p>}
    </div>
  );
}


