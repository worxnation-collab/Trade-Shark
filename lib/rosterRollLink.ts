/** Roster Roll pieces safe for the browser (no database, no crypto). */

export interface SingleView {
  id: string;
  date: string;
  handle: string; // as Roster Roll recorded it
  name: string;
  setName: string | null;
  number: string | null;
  variant: string | null;
}
