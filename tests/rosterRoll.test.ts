import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "./fakeDb";

const fake = fakeDb();
const db = fake.db;
vi.mock("@/lib/db", () => ({ db }));

// A card the single may come from: loose, priced, founder-owned, under the chase line.
const stockCard = (id: string, name: string) => ({
  id, name, status: "Priced", game: "Pokemon", player: null, setName: "Base", year: "1999", number: "58", variant: null, condition: "NM",
  gamePackId: null, listPrice: 3, readable: true, frontImage: `scans/${id}.jpg`, frontDisplay: null, category: "pokemon", partnerId: "matthew", senderId: null,
});
const cards = () => fake.t("card");

process.env.PLAYER_SECRET = "test-secret";
const { canPull, claimedSingle, isWinner, nyToday, parseDate, parseHandle, pullSingle, recordWinner, winnerCookie } = await import("@/lib/rosterRoll");

beforeEach(() => {
  fake.reset();
  fake.t("rosterRollClaim").push({ date: "2026-10-08", handle: "SharkFan", score: 9120, status: "unclaimed", cardId: null, buyerId: null });
  cards().push(stockCard("c1", "Pikachu"), stockCard("c2", "Eevee"));
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
    fake.t("card").length = 0;
    expect(await canPull("2026-10-08", "SharkFan")).toBe(false);
  });

  it("pulls one card into the winner's vault, flips the row, and a second pull does nothing", async () => {
    const card = await pullSingle("2026-10-08", "SharkFan", "b1");
    expect(card).toMatchObject({ name: expect.any(String), number: "58" });
    expect(cards().find((c) => c.id === card!.id)).toMatchObject({ status: "Vaulted" });
    expect(fake.t("rosterRollClaim")[0]).toMatchObject({ status: "claimed", cardId: card!.id, buyerId: "b1" });
    expect(await pullSingle("2026-10-08", "SharkFan", "b1")).toBeNull();
    expect(await canPull("2026-10-08", "SharkFan")).toBe(false);
    expect(cards().filter((c) => c.status === "Vaulted")).toHaveLength(1);
    expect(fake.t("vaultItem")).toHaveLength(1);
  });

  it("leaves the row unclaimed when there is nothing to give", async () => {
    fake.t("card").length = 0;
    expect(await pullSingle("2026-10-08", "SharkFan", "b1")).toBeNull();
    expect(fake.t("rosterRollClaim")[0]).toMatchObject({ status: "unclaimed", cardId: null });
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
    const card = await pullSingle("2026-10-08", "sharkfan", "b1");
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
});
