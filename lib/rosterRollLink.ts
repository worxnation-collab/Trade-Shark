/** Roster Roll pieces safe for the browser (no database, no crypto). */

/** The draft (Roster Roll, now Pokéroll): a daily free card for the top score. */
export const POKEROLL_URL = "https://pokeroll.fun";

export interface SingleView {
  id: string;
  date: string;
  handle: string; // as Roster Roll recorded it
  name: string;
  setName: string | null;
  number: string | null;
  variant: string | null;
}
