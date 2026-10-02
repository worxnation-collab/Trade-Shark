import { keys } from "../env";
import { skip, type IdentifyAdapter } from "./types";

/**
 * Placeholder for a sports card catalog (e.g. a paid checklist/price API).
 * It stays empty until SPORTS_CATALOG_API_KEY is set AND someone implements `identify` below.
 * Sports cards still get identified by filename, manifest, pasted lines, and vision.
 */
export const sportsCatalogIdentify: IdentifyAdapter = {
  id: "sports_catalog",
  label: "Sports catalog",
  games: ["Sports"],
  configured: () =>
    keys().sports ? { ok: true } : { ok: false, reason: "SPORTS_CATALOG_API_KEY not set (no free sports catalog)" },
  async identify() {
    return skip("Sports catalog adapter has a key but no provider wired yet — see lib/sources/sportsCatalog.ts");
  },
};
