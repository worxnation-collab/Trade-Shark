import { describe, expect, it } from "vitest";
import { checkPassword, hashPassword, normalizeUser, USER_RE } from "@/lib/game/account";

describe("account", () => {
  it("normalizes a username", () => {
    expect(normalizeUser("  Shark ")).toBe("shark");
    expect(USER_RE.test(normalizeUser("ab"))).toBe(false);
    expect(USER_RE.test(normalizeUser("shark_2"))).toBe(true);
  });

  it("a hash only matches the password that made it", async () => {
    const stored = await hashPassword("correct-horse");
    expect(await checkPassword("correct-horse", stored)).toBe(true);
    expect(await checkPassword("wrong-horse", stored)).toBe(false);
    expect(await checkPassword("correct-horse", null)).toBe(false);
  });
});
