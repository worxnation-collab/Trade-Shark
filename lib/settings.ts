import { db } from "./db";
import type { Condition, ShippingProfile } from "./types";

export interface FeeRule {
  pct: number; // 13.25 means 13.25%
  fixed: number;
}

export interface Settings {
  confidenceThreshold: number;
  minListPrice: number;
  minComps: number;
  /** Fallback chain after sold comps: use TCGplayer market, then (optionally) retail asks like Scryfall. */
  useTcgMarket: boolean;
  useRetailAskFallback: boolean;
  conditionMultipliers: Record<Condition, number>;
  fees: { ebay: FeeRule; tcgplayer: FeeRule; stripe: FeeRule; local: FeeRule };
  shipping: Record<ShippingProfile, number>;
  staleHours: number;
  /** Price sources disagree when max/min of their headline prices exceeds this ratio. */
  conflictRatio: number;
  titleTemplate: string;
  descriptionTemplate: string;
  shopNote: string;
  ebayCategory: { Pokemon: string; Magic: string; Sports: string; Other: string };
  ebayShippingProfileName: string;
  ebayReturnProfileName: string;
  ebayPaymentProfileName: string;
  ebayLocation: string;
  /** Characters people already chase. A card whose name/player contains one gets +25 wow. */
  chaseNames: string[];
  /** What the buyer pays for shipping, on top of the card or pack price. */
  buyerShipping: { pwe: number; bubble: number; freeAt: number };
  /** Chase cards ($10+) in the reveal game, per category. Off until I turn it on (needs one chase card scanned). */
  chaseOn: { baseball: boolean; football: boolean; pokemon: boolean };
  /** Consignment (outside senders): public page, submissions, sender tags and sender payouts. Locked until I open it. */
  consignOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  confidenceThreshold: 0.8,
  minListPrice: 2,
  minComps: 3,
  useTcgMarket: true,
  useRetailAskFallback: false,
  conditionMultipliers: { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.3 },
  fees: {
    ebay: { pct: 13.25, fixed: 0.4 },
    tcgplayer: { pct: 10.25, fixed: 0.3 },
    stripe: { pct: 2.9, fixed: 0.3 },
    local: { pct: 0, fixed: 0 },
  },
  shipping: { standard: 1.0, bubble: 4.5, slab: 6.0 },
  staleHours: 24,
  conflictRatio: 1.5,
  titleTemplate: "{year} {set} {name} {number} {variant} {grade} {condition}",
  descriptionTemplate: [
    "{name} from {set} {number}. {variant_line}",
    "{condition_line}",
    "The photos are this exact card. It goes out sleeved, from Florida.",
    "",
    "{shop_note}",
  ].join("\n"),
  shopNote: "Thanks for hanging out at Trade Shark!",
  ebayCategory: { Pokemon: "183454", Magic: "183454", Sports: "261328", Other: "183454" },
  ebayShippingProfileName: "",
  ebayReturnProfileName: "",
  ebayPaymentProfileName: "",
  ebayLocation: "Florida",
  chaseNames: ["Pikachu", "Charizard", "Umbreon"],
  buyerShipping: { pwe: 1.5, bubble: 6, freeAt: 35 },
  chaseOn: { baseball: false, football: false, pokemon: false },
  consignOpen: false,
};

function deepMerge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = out[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b, v) : v;
  }
  return out as T;
}

export async function getSettings(): Promise<Settings> {
  const row = await db.setting.findUnique({ where: { key: "settings" } });
  if (!row) return DEFAULT_SETTINGS;
  try {
    return deepMerge(DEFAULT_SETTINGS, JSON.parse(row.value));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Partial<Settings>) {
  const merged = deepMerge(await getSettings(), s);
  await db.setting.upsert({
    where: { key: "settings" },
    create: { key: "settings", value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  return merged;
}
