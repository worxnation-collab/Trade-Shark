import { Prisma } from "@prisma/client";

/**
 * A small in-memory stand-in for the Prisma client: enough of where (equals, in, not, lt/gt, contains, mode
 * insensitive, AND/OR/NOT, null), unique keys, include of a few relations, and $transaction with rollback, so the real
 * library code (stock rules included) runs against it.
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const UNIQUE: Record<string, string[][]> = {
  rosterRollClaim: [["date"]],
  creditEntry: [["ref"]],
  vaultItem: [["source", "sourceRef"]],
  buyer: [["stripeCustomerId"]],
};
const DEFAULTS: Record<string, () => Row> = {
  vaultItem: () => ({ status: "in_vault", orderId: null, wonAt: new Date(), updatedAt: new Date() }),
  shipQuote: () => ({ packIds: [], vaultIds: [], usedAt: null, createdAt: new Date() }),
  shipOrder: () => ({ paymentIntentId: null, labelPath: null, trackingUrl: null, shippedAt: null, createdAt: new Date() }),
  rosterRollClaim: () => ({ status: "unclaimed", cardId: null, buyerId: null, claimedAt: null }),
  creditEntry: () => ({ createdAt: new Date() }),
};
// relation name → [table, local key, foreign key, many?]
const RELATIONS: Record<string, Record<string, [string, string, string, boolean]>> = {
  shipOrder: { buyer: ["buyer", "buyerId", "id", false], packs: ["gamePack", "id", "orderId", true], vaultItems: ["vaultItem", "id", "orderId", true] },
  vaultItem: { order: ["shipOrder", "orderId", "id", false] },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const eq = (a: unknown, b: unknown, ci = false) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : ci && typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b);

function field(v: unknown, cond: unknown): boolean {
  if (!isObj(cond)) return cond === null ? v == null : eq(v, cond);
  const ci = cond.mode === "insensitive";
  for (const [op, x] of Object.entries(cond)) {
    if (op === "mode") continue;
    if (op === "equals" && !(x === null ? v == null : eq(v, x, ci))) return false;
    if (op === "in" && !(x as unknown[]).some((y) => eq(v, y, ci))) return false;
    if (op === "not" && (isObj(x) ? field(v, x) : x === null ? v == null : eq(v, x, ci))) return false;
    if (op === "lt" && !(v != null && (v as number) < (x as number))) return false;
    if (op === "gt" && !(v != null && (v as number) > (x as number))) return false;
    if (op === "gte" && !(v != null && (v as number) >= (x as number))) return false;
    if (op === "lte" && !(v != null && (v as number) <= (x as number))) return false;
    if (op === "contains" && !(typeof v === "string" && (ci ? v.toLowerCase().includes(String(x).toLowerCase()) : v.includes(String(x))))) return false;
  }
  return true;
}

export function matches(r: Row, w: Where | undefined): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, c]) => {
    if (k === "AND") return (c as Where[]).every((x) => matches(r, x));
    if (k === "OR") return (c as Where[]).some((x) => matches(r, x));
    if (k === "NOT") return !(Array.isArray(c) ? c : [c]).some((x) => matches(r, x as Where));
    return field(r[k], c);
  });
}

let seq = 0;
export function fakeDb() {
  const tables: Record<string, Row[]> = {};
  const t = (name: string) => (tables[name] ??= []);

  const withIncludes = (name: string, r: Row, include?: Record<string, unknown>): Row => {
    if (!include) return { ...r };
    const out: Row = { ...r };
    for (const rel of Object.keys(include)) {
      const [table, local, foreign, many] = RELATIONS[name][rel];
      const hits = t(table).filter((x) => r[local] != null && x[foreign] === r[local]);
      out[rel] = many ? hits.map((x) => ({ ...x })) : (hits[0] ? { ...hits[0] } : null);
    }
    return out;
  };

  const model = (name: string) => ({
    findFirst: async (a: { where?: Where; include?: Row; select?: Row; skip?: number } = {}) => {
      const hit = t(name).filter((r) => matches(r, a.where))[a.skip ?? 0];
      return hit ? withIncludes(name, hit, a.include ?? relSelect(name, a.select)) : null;
    },
    findUnique: async (a: { where: Where; include?: Row; select?: Row }) => {
      const hit = t(name).find((r) => matches(r, a.where));
      return hit ? withIncludes(name, hit, a.include ?? relSelect(name, a.select)) : null;
    },
    findUniqueOrThrow: async (a: { where: Where; include?: Row; select?: Row }) => {
      const hit = t(name).find((r) => matches(r, a.where));
      if (!hit) throw new Error(`${name} not found`);
      return withIncludes(name, hit, a.include ?? relSelect(name, a.select));
    },
    findMany: async (a: { where?: Where; include?: Row; select?: Row } = {}) => t(name).filter((r) => matches(r, a.where)).map((r) => withIncludes(name, r, a.include ?? relSelect(name, a.select))),
    count: async (a: { where?: Where } = {}) => t(name).filter((r) => matches(r, a.where)).length,
    create: async (a: { data: Row }) => {
      const row: Row = { id: `${name}_${++seq}`, ...(DEFAULTS[name]?.() ?? {}), ...a.data };
      for (const keys of UNIQUE[name] ?? [])
        if (keys.every((k) => row[k] != null) && t(name).some((r) => keys.every((k) => eq(r[k], row[k]))))
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      t(name).push(row);
      return { ...row };
    },
    update: async (a: { where: Where; data: Row }) => {
      const hit = t(name).find((r) => matches(r, a.where));
      if (!hit) throw new Error(`${name} not found`);
      return { ...Object.assign(hit, a.data) };
    },
    updateMany: async (a: { where?: Where; data: Row }) => {
      const hits = t(name).filter((r) => matches(r, a.where));
      hits.forEach((r) => Object.assign(r, a.data));
      return { count: hits.length };
    },
    delete: async (a: { where: Where }) => {
      const i = t(name).findIndex((r) => matches(r, a.where));
      return t(name).splice(i, 1)[0];
    },
    aggregate: async (a: { where?: Where; _sum: Record<string, true> }) => {
      const rows = t(name).filter((r) => matches(r, a.where));
      const _sum: Record<string, number | null> = {};
      for (const k of Object.keys(a._sum)) _sum[k] = rows.length ? rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) : null;
      return { _sum };
    },
  });
  // A select naming a relation (e.g. order: { select }) is treated as an include of it.
  const relSelect = (name: string, select?: Row) => {
    if (!select || !RELATIONS[name]) return undefined;
    const rels = Object.keys(select).filter((k) => RELATIONS[name][k]);
    return rels.length ? Object.fromEntries(rels.map((k) => [k, true])) : undefined;
  };

  const names = ["card", "rosterRollClaim", "vaultItem", "creditEntry", "shipQuote", "shipOrder", "gamePack", "gameCharge", "buyer", "setting"];
  const models = Object.fromEntries(names.map((n) => [n, model(n)])) as Record<string, ReturnType<typeof model>>;
  const db = {
    ...models,
    // All-or-nothing, like Postgres: a throw inside puts every table back the way it was.
    $transaction: async <T>(fn: (tx: typeof models) => Promise<T>): Promise<T> => {
      const snap = structuredClone(tables);
      try {
        return await fn(models);
      } catch (e) {
        for (const k of Object.keys(tables)) delete tables[k];
        Object.assign(tables, snap);
        throw e;
      }
    },
  };
  return { db, tables, t, reset: () => Object.keys(tables).forEach((k) => delete tables[k]) };
}
