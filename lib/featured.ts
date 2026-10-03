import { db } from "./db";

/** The one item I pinned to the home hero. A pin beats the wow score while the item is still live. */
export type Featured = { kind: "card" | "stack"; id: string } | null;

const KEY = "featured";

export async function getFeatured(): Promise<Featured> {
  try {
    const row = await db.setting.findUnique({ where: { key: KEY } });
    const v = row ? (JSON.parse(row.value) as Featured) : null;
    return v && (v.kind === "card" || v.kind === "stack") && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function setFeatured(f: Featured) {
  if (!f) return db.setting.deleteMany({ where: { key: KEY } });
  const value = JSON.stringify(f);
  return db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export const isFeatured = (f: Featured, kind: "card" | "stack", id: string) => !!f && f.kind === kind && f.id === id;
