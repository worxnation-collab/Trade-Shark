import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the two tables the claim touches.
type Row = { date: string; handle: string; score: number; status: string; cardId: string | null };
type Card = { id: string; status: string; name: string };
const state = { rows: [] as Row[], cards: [] as Card[] };
const sameHandle = (a: string, w: { equals: string }) => a.toLowerCase() === w.equals.toLowerCase();
const rowMatch = (r: Row, w: { date: string; handle: { equals: string }; status?: string }) => r.date === w.date && sameHandle(r.handle, w.handle) && (!w.status || r.status === w.status);
const inStock = () => state.cards.filter((c) => c.status === "Priced");
const idOf = (w: { AND?: { id?: string }[]; id?: string }) => w.id ?? w.AND?.find((x) => x.id)?.id;

const fake = {
  rosterRollClaim: {
    findFirst: async ({ where }: { where: Parameters<typeof rowMatch>[1] }) => state.rows.find((r) => rowMatch(r, where)) ?? null,
    updateMany: async ({ where, data }: { where: Parameters<typeof rowMatch>[1]; data: Partial<Row> }) => {
      const hit = state.rows.filter((r) => rowMatch(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }: { where: { date: string }; data: Partial<Row> }) => Object.assign(state.rows.find((r) => r.date === where.date)!, data),
    create: async ({ data }: { data: Omit<Row, "status" | "cardId"> }) => {
      if (state.rows.some((r) => r.date === data.date)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });
      state.rows.push({ ...data, status: "unclaimed", cardId: null });
    },
  },
  card: {
    count: async () => inStock().length,
    findFirst: async ({ skip = 0 }: { skip?: number }) => inStock()[skip] ?? null,
    updateMany: async ({ where, data }: { where: { AND?: { id?: string }[] }; data: Partial<Card> }) => {
      const c = inStock().find((x) => x.id === idOf(where));
      if (c) Object.assign(c, data);
      return { count: c ? 1 : 0 };
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...state.cards.find((c) => c.id === where.id)!, game: "Pokemon", player: null, setName: "Base", year: "1999", number: "58", variant: null }),
    findUnique: async ({ where }: { where: { id: string } }) => {
      const c = state.cards.find((x) => x.id === where.id);
      return c ? { ...c, game: "Pokemon", player: null, setName: "Base", year: "1999", number: "58", variant: null } : null;
    },
  },
};
const db = { ...fake, $transaction: async <T,>(fn: (tx: typeof fake) => Promise<T>) => fn(fake) };
vi.mock("@/lib/db", () => ({ db }));

process.env.PLAYER_SECRET = "test-secret";
const { addressMailto, canPull, claimedSingle, isWinner, nyToday, parseDate, parseHandle, pullSingle, recordWinner, winnerCookie } = await import("@/lib/rosterRoll");

beforeEach(() => {
  state.rows = [{ date: "2026-10-08", handle: "SharkFan", score: 9120, status: "unclaimed", cardId: null }];
  state.cards = [
    { id: "c1", status: "Priced", name: "Pikachu" },
    { id: "c2", status: "Priced", name: "Eevee" },
  ];
});

describe("Roster Roll claim", () => {
  it("checks the link", () => {
    expect(parseDate("2026-10-08")).toBe("2026-10-08");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("10/08/2026")).toBeNull();
    expect(parseHandle("ab")).toBeNull();
    expect(parseHandle("abc")).toBe("abc");
    expect(parseHandle("a".repeat(16))).not.toBeNull();
    expect(parseHandle("a".repeat(17))).toBeNull();
    expect(parseHandle("two words")).toBeNull();
    expect(nyToday(new Date("2026-10-09T03:30:00Z"))).toBe("2026-10-08"); // 11:30 pm in New York
  });

  it("offers the pull only for a matching unclaimed row with stock", async () => {
    expect(await canPull("2026-10-08", "sharkfan")).toBe(true);
    expect(await canPull("2026-10-08", "someone")).toBe(false);
    expect(await canPull("2026-10-07", "SharkFan")).toBe(false);
    expect(await canPull("2026-10-08", "x")).toBe(false);
    state.cards = [];
    expect(await canPull("2026-10-08", "SharkFan")).toBe(false);
  });

  it("pulls one card at $0, flips the row, and a second pull does nothing", async () => {
    const card = await pullSingle("2026-10-08", "SharkFan");
    expect(card).toMatchObject({ name: expect.any(String), number: "58" });
    const taken = state.cards.find((c) => c.id === card!.id)!;
    expect(taken).toMatchObject({ status: "Sold", soldChannel: "roster-roll", soldPrice: 0 });
    expect(state.rows[0]).toMatchObject({ status: "claimed", cardId: card!.id });
    expect(await pullSingle("2026-10-08", "SharkFan")).toBeNull();
    expect(await canPull("2026-10-08", "SharkFan")).toBe(false);
    expect(state.cards.filter((c) => c.status === "Sold")).toHaveLength(1);
  });

  it("leaves the row unclaimed when there is nothing to give", async () => {
    state.cards = [];
    expect(await pullSingle("2026-10-08", "SharkFan")).toBeNull();
  });

  it("records one winner per date", async () => {
    const now = new Date("2026-10-09T16:00:00Z");
    expect(await recordWinner({ date: "2026-10-09", handle: "Reef_99", score: 4000 }, now)).toEqual({ ok: true });
    expect(await recordWinner({ date: "2026-10-09", handle: "Other", score: 5000 }, now)).toMatchObject({ ok: false, status: 409 });
    expect(await recordWinner({ date: "2026-10-10", handle: "Reef_99", score: 1 }, now)).toMatchObject({ ok: false, status: 400 });
    expect(await recordWinner({ date: "2026-10-01", handle: "no", score: 1 }, now)).toMatchObject({ ok: false, status: 400 });
    expect(await recordWinner({ date: "2026-10-01", handle: "Reef_99", score: -2 }, now)).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps the card for the winner's browser only", async () => {
    const card = await pullSingle("2026-10-08", "sharkfan");
    expect(card).toMatchObject({ date: "2026-10-08", handle: "SharkFan" }); // the handle as Roster Roll recorded it
    const cookie = winnerCookie("2026-10-08", "SharkFan");
    expect(isWinner(cookie, "2026-10-08", "SHARKFAN")).toBe(true);
    expect(isWinner(undefined, "2026-10-08", "SharkFan")).toBe(false);
    expect(isWinner(cookie, "2026-10-07", "SharkFan")).toBe(false);
    expect(isWinner(cookie, "2026-10-08", "SomeoneElse")).toBe(false);
    expect(isWinner(cookie.slice(0, -1) + "0", "2026-10-08", "SharkFan")).toBe(false);
    expect(await claimedSingle("2026-10-08", "SharkFan")).toMatchObject({ id: card!.id, name: card!.name });
  });

  it("has no refresh view before the pull", async () => {
    expect(await claimedSingle("2026-10-08", "SharkFan")).toBeNull();
  });

  it("builds the address email", () => {
    const href = addressMailto("shop@example.com", { date: "2026-10-09", handle: "SharkFan", name: "Pikachu" });
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("shop@example.com");
    expect(url.searchParams.get("subject")).toBe("Roster Roll single · 2026-10-09 · SharkFan");
    expect(url.searchParams.get("body")).toBe(
      ["Handle: SharkFan", "Date: 2026-10-09", "Card: Pikachu", "", "Ship to:", "Name:", "Address:", "City, state, ZIP:", "Phone:"].join("\r\n"),
    );
  });
});
