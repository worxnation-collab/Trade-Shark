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

/** The "Email me your address" link: a mailto to the shop address with the claim filled in and blank ship-to lines. */
export function addressMailto(email: string, c: Pick<SingleView, "date" | "handle" | "name">): string {
  const subject = `Roster Roll single · ${c.date} · ${c.handle}`;
  const body = [`Handle: ${c.handle}`, `Date: ${c.date}`, `Card: ${c.name}`, "", "Ship to:", "Name:", "Address:", "City, state, ZIP:", "Phone:"].join("\r\n");
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
