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
