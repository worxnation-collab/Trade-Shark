import { describe, expect, it } from "vitest";
import { CATEGORY_KEYS, categorize, isCategory, isPublicCategory, PUBLIC_CATEGORIES, sportOf } from "@/lib/categories";


describe("categories", () => {
  it("the public shop shows Pokémon only; baseball and football stay categories for the desk", () => {
    expect(PUBLIC_CATEGORIES).toEqual(["pokemon"]);
    expect(isPublicCategory("pokemon")).toBe(true);
    expect(isPublicCategory("baseball")).toBe(false);
    expect(isPublicCategory("football")).toBe(false);
    expect(CATEGORY_KEYS).toEqual(["baseball", "football", "pokemon"]);
    expect(isCategory("baseball")).toBe(true);
  });

  it("Pokemon cards go in the Pokemon Pack; Magic and other games never get packed", () => {
    expect(categorize({ game: "Pokemon" })).toBe("pokemon");
    expect(categorize({ game: "Magic" })).toBe(null);
    expect(categorize({ game: "Other" })).toBe(null);
  });

  it("sports split into baseball and football from team or set; basketball stays out", () => {
    expect(categorize({ game: "Sports", team: "New York Yankees" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "Dodgers" })).toBe("baseball");
    expect(categorize({ game: "Sports", setName: "2023 Bowman Chrome" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "Kansas City Chiefs" })).toBe("football");
    expect(categorize({ game: "Sports", setName: "Panini Prizm Football" })).toBe("football");
    expect(categorize({ game: "Sports", team: "Los Angeles Lakers" })).toBe(null);
    expect(sportOf({ team: "Lakers" })).toBe("basketball");
    expect(categorize({ game: "Sports", setName: "NBA Hoops" })).toBe(null);
  });

  it("shared city names need the full team: Giants and Cardinals alone stay unsorted", () => {
    expect(categorize({ game: "Sports", team: "San Francisco Giants" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "New York Giants" })).toBe("football");
    expect(categorize({ game: "Sports", team: "St. Louis Cardinals" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "Arizona Cardinals" })).toBe("football");
    expect(categorize({ game: "Sports", team: "Giants" })).toBe(null);
    expect(categorize({ game: "Sports" })).toBe(null);
  });
});

