/**
 * The shop sells three products, one pack per category: Baseball Pack, Football Pack, Pokemon Pack.
 * A card's category comes from fields identification already fills (game, team, set, title); no new source.
 * Basketball, Magic and anything unsorted stay in inventory and are never packed.
 */
export const CATEGORIES = [
  { key: "baseball", name: "Baseball", product: "Baseball Pack" },
  { key: "football", name: "Football", product: "Football Pack" },
  { key: "pokemon", name: "Pokemon", product: "Pokemon Pack" },
] as const;
export type Category = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as Category[];

export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORY_KEYS as string[]).includes(v);
export const categoryOf = (key: string | null | undefined) => CATEGORIES.find((c) => c.key === key) ?? null;
export const productName = (key: string | null | undefined) => categoryOf(key)?.product ?? "Pack";

/** Categories on the public shop. The desk still scans, prices and builds all three. */
// Baseball and football come back by adding "baseball" / "football" to this list once they're stocked.
export const PUBLIC_CATEGORIES: Category[] = ["pokemon"];
export const isPublicCategory = (v: unknown): v is Category => isCategory(v) && PUBLIC_CATEGORIES.includes(v);

// Full names settle the cities two leagues share (Giants, Cardinals); nicknames catch "Yankees" on its own.
const MLB = [
  "Arizona Diamondbacks", "Atlanta Braves", "Baltimore Orioles", "Boston Red Sox", "Chicago Cubs", "Chicago White Sox", "Cincinnati Reds",
  "Cleveland Guardians", "Cleveland Indians", "Colorado Rockies", "Detroit Tigers", "Houston Astros", "Kansas City Royals", "Los Angeles Angels",
  "Los Angeles Dodgers", "Miami Marlins", "Florida Marlins", "Milwaukee Brewers", "Minnesota Twins", "New York Mets", "New York Yankees",
  "Oakland Athletics", "Athletics", "Philadelphia Phillies", "Pittsburgh Pirates", "San Diego Padres", "San Francisco Giants", "Seattle Mariners",
  "St. Louis Cardinals", "St Louis Cardinals", "Tampa Bay Rays", "Texas Rangers", "Toronto Blue Jays", "Washington Nationals", "Montreal Expos",
];
const MLB_NICK = [
  "Diamondbacks", "D-backs", "Braves", "Orioles", "Red Sox", "Cubs", "White Sox", "Reds", "Guardians", "Rockies", "Tigers", "Astros", "Royals",
  "Angels", "Dodgers", "Marlins", "Brewers", "Twins", "Mets", "Yankees", "Phillies", "Pirates", "Padres", "Mariners", "Rays", "Blue Jays",
  "Nationals", "Expos",
];
const NFL = [
  "Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills", "Carolina Panthers", "Chicago Bears", "Cincinnati Bengals",
  "Cleveland Browns", "Dallas Cowboys", "Denver Broncos", "Detroit Lions", "Green Bay Packers", "Houston Texans", "Indianapolis Colts",
  "Jacksonville Jaguars", "Kansas City Chiefs", "Las Vegas Raiders", "Oakland Raiders", "Los Angeles Chargers", "San Diego Chargers",
  "Los Angeles Rams", "St. Louis Rams", "Miami Dolphins", "Minnesota Vikings", "New England Patriots", "New Orleans Saints", "New York Giants",
  "New York Jets", "Philadelphia Eagles", "Pittsburgh Steelers", "San Francisco 49ers", "Seattle Seahawks", "Tampa Bay Buccaneers",
  "Tennessee Titans", "Washington Commanders", "Washington Football Team", "Washington Redskins",
];
const NFL_NICK = [
  "Falcons", "Ravens", "Bills", "Bears", "Bengals", "Browns", "Cowboys", "Broncos", "Lions", "Packers", "Texans", "Colts", "Chiefs", "Raiders",
  "Chargers", "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Eagles", "Steelers", "49ers", "Niners", "Seahawks", "Buccaneers", "Bucs",
  "Titans", "Commanders",
];
const NBA_NICK = [
  "Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks", "Nuggets", "Pistons", "Warriors", "Rockets", "Pacers", "Clippers",
  "Lakers", "Grizzlies", "Heat", "Bucks", "Timberwolves", "Pelicans", "Knicks", "Thunder", "Magic", "76ers", "Sixers", "Suns", "Trail Blazers",
  "Blazers", "Kings", "Spurs", "Raptors", "Jazz", "Wizards", "SuperSonics",
];

const words = (list: string[]) => new RegExp(`\\b(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
const MLB_FULL = words(MLB);
const NFL_FULL = words(NFL);
const MLB_RE = words(MLB_NICK);
const NFL_RE = words(NFL_NICK);
const NBA_RE = words(NBA_NICK);

type SportHint = "baseball" | "football" | "basketball" | null;

/** From the printed team and set: league words first, full team names next, nicknames last. */
export function sportOf(c: { team?: string | null; setName?: string | null; title?: string | null; variant?: string | null }): SportHint {
  const team = c.team ?? "";
  const text = [c.setName, c.title, c.variant].filter(Boolean).join(" ");
  const all = `${team} ${text}`;
  if (/\bbasketball\b|\bnba\b/i.test(all)) return "basketball";
  if (/\bfootball\b|\bnfl\b/i.test(all)) return "football";
  if (/\bbaseball\b|\bmlb\b|\bbowman\b|allen\s*&?\s*ginter|\bheritage\b/i.test(all)) return "baseball";
  if (MLB_FULL.test(team)) return "baseball";
  if (NFL_FULL.test(team)) return "football";
  const mlb = MLB_RE.test(team), nfl = NFL_RE.test(team), nba = NBA_RE.test(team);
  if (mlb && !nfl && !nba) return "baseball";
  if (nfl && !mlb && !nba) return "football";
  if (nba && !mlb && !nfl) return "basketball";
  return null; // unknown or ambiguous: I set it by hand
}

/** The pack a card belongs in, or null (basketball, Magic, other, or a sports card I haven't sorted). */
export function categorize(c: { game: string; team?: string | null; setName?: string | null; title?: string | null; variant?: string | null }): Category | null {
  if (c.game === "Pokemon") return "pokemon";
  if (c.game !== "Sports") return null;
  const s = sportOf(c);
  return s === "baseball" || s === "football" ? s : null;
}
