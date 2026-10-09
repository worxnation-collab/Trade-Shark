import type { CardFields, Game, IdentCandidate } from "../types";

/**
 * Every adapter fails soft: it returns a status + reason instead of throwing.
 * The pipeline records one SourceRun row per attempt so you can see why a source said nothing.
 */
export type RunStatus = "ok" | "no_match" | "skipped" | "error";

export interface SourceResult<T> {
  status: RunStatus;
  reason?: string;
  data?: T;
}

export interface IdentifyContext {
  cardId: string;
  game: Game;
  hints: CardFields; // best-known fields so far (manifest > vision > filename)
  frontImage?: string | null;
  backImage?: string | null;
  frontHash?: string | null;
  backHash?: string | null;
}

export interface IdentifyAdapter {
  id: string;
  label: string;
  /** Games this source can identify; "any" = run regardless of detected game. */
  games: Game[] | "any";
  configured(): { ok: boolean; reason?: string };
  identify(ctx: IdentifyContext): Promise<SourceResult<IdentCandidate[]>>;
}

export interface QuoteInput {
  source: string;
  kind: "market" | "retail_ask" | "sold_comp" | "manual" | "summary";
  label?: string;
  amount: number;
  currency?: string;
  condition?: string | null;
  rawTitle?: string;
  url?: string;
  soldAt?: Date;
  excluded?: boolean;
  excludeReason?: string;
}

export interface PriceContext {
  cardId: string;
  game: Game;
  fields: CardFields;
  catalogId?: string | null;
  identSource?: string | null;
  pastedComps?: string | null;
}

export interface PriceAdapter {
  id: string;
  label: string;
  games: Game[] | "any";
  configured(): { ok: boolean; reason?: string };
  price(ctx: PriceContext): Promise<SourceResult<QuoteInput[]>>;
}

export const skip = (reason: string) => ({ status: "skipped" as const, reason });
export const fail = (reason: string) => ({ status: "error" as const, reason });
export const none = (reason: string) => ({ status: "no_match" as const, reason });
