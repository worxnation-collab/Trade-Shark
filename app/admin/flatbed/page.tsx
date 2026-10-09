import cvPkg from "@techstark/opencv-js/package.json";
import { db } from "@/lib/db";
import { FlatbedSplit } from "./FlatbedSplit";

export const metadata = { title: "Flatbed split" };

export default async function FlatbedPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { batch } = await searchParams;
  const b = batch ? await db.batch.findUnique({ where: { id: batch }, select: { id: true, name: true } }) : null;
  // Keep numbering going when adding another sheet to the same batch.
  const prior = b ? await db.uploadFile.count({ where: { batchId: b.id, side: "front", pairKey: { not: null } } }) : 0;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Flatbed split</h1>
        <p className="text-sm text-navy/60">
          One copier scan, many cards. Check the boxes, fix any misses, then commit. Crops land in the same Inbox as feeder scans.
        </p>
      </div>
      <FlatbedSplit cvSrc={`/vendor/opencv-${cvPkg.version}.js`} batchId={b?.id} batchName={b?.name} startAt={prior + 1} />
    </div>
  );
}
