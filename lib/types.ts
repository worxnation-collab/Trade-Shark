export const GAMES = ["Pokemon", "Sports", "Magic", "Other"] as const;
export type Game = (typeof GAMES)[number];

export const STATUSES = ["Inbox", "Identified", "Priced", "Ready", "Listed", "Sold", "Archived", "BulkHold", "LilStack", "NeedsLook", "Pulled"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  Inbox: "Inbox",
  Identified: "Identified",
  Priced: "Priced",
  Ready: "For Sale",
  Listed: "Listed",
  Sold: "Sold",
  Archived: "Archived",
  BulkHold: "Bulk Hold",
  LilStack: "Lil' Stack",
  NeedsLook: "Needs a look",
  Pulled: "Pulled",
};
/** Cards the public shop may show. */
export const FOR_SALE: Status[] = ["Ready", "Listed"];

export const PILES = ["none", "unpaired", "unreadable", "likely_bulk", "duplicate"] as const;
export type Pile = (typeof PILES)[number];
export const PILE_LABEL: Record<Pile, string> = {
  none: "Main",
  unpaired: "Unpaired",
  unreadable: "Unreadable",
  likely_bulk: "Likely bulk",
  duplicate: "Duplicate",
};

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const SHIPPING_PROFILES = ["standard", "bubble", "slab"] as const;
export type ShippingProfile = (typeof SHIPPING_PROFILES)[number];

/** Fields an identification source can fill. */
export interface CardFields {
  game?: Game;
  name?: string;
  setName?: string;
  setCode?: string;
  number?: string;
  year?: string;
  variant?: string;
  rarity?: string;
  player?: string;
  team?: string;
  condition?: Condition;
  graded?: string;
}
export const IDENT_FIELDS = ["game", "name", "setName", "setCode", "number", "year", "variant", "rarity", "player", "team"] as const;
export type IdentField = (typeof IDENT_FIELDS)[number];

export interface IdentCandidate {
  source: string;
  confidence: number;
  fields: CardFields;
  fieldConfidence?: Partial<Record<IdentField, number>>;
  catalogId?: string;
  catalogImage?: string;
  tcgplayerId?: string;
  tcgplayerUrl?: string;
  note?: string;
}
