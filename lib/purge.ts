import { db } from "./db";
import { BUCKET, supabase } from "./storage";

/**
 * Remove every seeded / demo / sample card and anything built from one: packs (any status), their payouts rows and
 * reserve entries, the unshipped parcel holding them, the seed batches, and the seed/ images in storage.
 * Real uploaded scans are never touched. Runs in chunks; call until `left` is 0.
 */
const SEED_BATCH = { OR: [{ name: { contains: "seed", mode: "insensitive" as const } }, { name: { contains: "demo", mode: "insensitive" as const } }, { name: { contains: "sample", mode: "insensitive" as const } }] };
const seedCardWhere = { OR: [{ notes: "TEST SEED" }, { batch: SEED_BATCH }] };

export async function purgeDemo(chunk = 300) {
  const seedIds = (await db.card.findMany({ where: seedCardWhere, select: { id: true } })).map((c) => c.id);
  // Packs built from seed cards (or already marked), whatever their status.
  const packs = await db.gamePack.findMany({
    where: { OR: [{ status: "seed-delete" }, { cards: { some: { id: { in: seedIds } } } }, { cardIds: { hasSome: seedIds.length ? seedIds : ["-"] } }] },
    select: { id: true, orderId: true },
  });
  const packIds = packs.map((p) => p.id);
  const orderIds = [...new Set(packs.map((p) => p.orderId).filter((x): x is string => !!x))];
  if (packIds.length) {
    await db.card.updateMany({ where: { gamePackId: { in: packIds } }, data: { gamePackId: null } });
    await db.partnerEarning.deleteMany({ where: { packId: { in: packIds } } });
    await db.senderEarning.deleteMany({ where: { packId: { in: packIds } } });
    await db.reserveEntry.deleteMany({ where: { ref: { in: packIds.map((id) => `pack:${id}`) } } });
    await db.gamePack.deleteMany({ where: { id: { in: packIds } } });
    // A parcel left with no packs (and never shipped) goes too.
    await db.shipOrder.deleteMany({ where: { id: { in: orderIds }, shippedAt: null, packs: { none: {} } } });
  }
  // Leftovers from earlier demo seeds: closed packs whose cards no longer exist, and parcels with no packs left.
  const closed = await db.gamePack.findMany({ where: { status: { in: ["dissolved", "expired"] } }, select: { id: true, cardIds: true } });
  const exist = new Set((await db.card.findMany({ where: { id: { in: closed.flatMap((p) => p.cardIds) } }, select: { id: true } })).map((c) => c.id));
  const ghosts = closed.filter((p) => !p.cardIds.some((id) => exist.has(id))).map((p) => p.id);
  if (ghosts.length) await db.gamePack.deleteMany({ where: { id: { in: ghosts } } });
  const emptyOrders = await db.shipOrder.deleteMany({ where: { shippedAt: null, labelPath: null, packs: { none: {} } } });
  const batch = seedIds.slice(0, chunk);
  if (batch.length) await db.card.deleteMany({ where: { id: { in: batch } } }); // quotes and source runs cascade
  const left = await db.card.count({ where: seedCardWhere });
  if (!left) await db.batch.deleteMany({ where: { ...SEED_BATCH, cards: { none: {} } } });
  return { packs: packIds.length + ghosts.length, orders: emptyOrders.count, cards: batch.length, left };
}

/** Delete the seed images (seed/…) from the scans bucket, a page at a time. Returns how many were removed. */
export async function purgeSeedImages() {
  const sb = supabase();
  if (!sb) return 0;
  let removed = 0;
  for (const dir of ["seed/ptcg", "seed/loc", "seed/football", "seed/baseball", "seed/pokemon", "seed"]) {
    for (let i = 0; i < 20; i++) {
      const { data } = await sb.storage.from(BUCKET).list(dir, { limit: 100 });
      const files = (data ?? []).filter((f) => f.id).map((f) => `${dir}/${f.name}`);
      if (!files.length) break;
      await sb.storage.from(BUCKET).remove(files);
      removed += files.length;
    }
  }
  return removed;
}

/** Cards that came from a seed, demo or sample (should always be 0 now). */
export const demoCardCount = () => db.card.count({ where: seedCardWhere });
