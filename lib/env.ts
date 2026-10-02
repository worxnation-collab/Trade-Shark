/** Which optional sources are configured. Missing keys just skip a source. */
export function keys() {
  const e = process.env;
  return {
    pokemontcg: e.POKEMONTCG_API_KEY || "",
    anthropic: e.ANTHROPIC_API_KEY || "",
    anthropicModel: e.ANTHROPIC_MODEL || "claude-opus-5-5",
    openai: e.OPENAI_API_KEY || "",
    openaiModel: e.OPENAI_MODEL || "gpt-4o-mini",
    ebayId: e.EBAY_CLIENT_ID || "",
    ebaySecret: e.EBAY_CLIENT_SECRET || "",
    ebayMarketplace: e.EBAY_MARKETPLACE || "EBAY_US",
    sports: e.SPORTS_CATALOG_API_KEY || "",
    visionConcurrency: Math.max(1, Number(e.VISION_CONCURRENCY || 2)),
  };
}

export function siteUrl() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

export function shopEmail() {
  return process.env.SHOP_EMAIL || "";
}

export function dataDir() {
  return process.env.DATA_DIR || "./data";
}

/** Required settings that are missing. Shown on the admin desk instead of a crash. */
export function missingConfig() {
  const e = process.env;
  const missing: { key: string; why: string }[] = [];
  if (!e.TRADE_SHARK_PASSWORD) missing.push({ key: "TRADE_SHARK_PASSWORD", why: "password for the desk" });
  if (!e.DATABASE_URL) missing.push({ key: "DATABASE_URL", why: "Supabase transaction pooler string (port 6543) with ?pgbouncer=true&connection_limit=1&schema=trade_shark" });
  if (!e.DIRECT_URL) missing.push({ key: "DIRECT_URL", why: "Supabase session pooler string (port 5432) with ?schema=trade_shark" });
  if (e.SUPABASE_URL && !(e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY))
    missing.push({ key: "SUPABASE_SECRET_KEY", why: "secret key so the desk can read/write the private scans bucket" });
  return missing;
}
