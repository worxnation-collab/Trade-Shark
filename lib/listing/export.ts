import type { Card } from "@prisma/client";
import type { Settings } from "../settings";
import { CONDITION_LONG, renderDescription, renderTitle } from "./templates";

export function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: unknown[][]) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * eBay ungraded trading-card condition descriptor (Card Condition, ID 40001).
 * Values from eBay's trading card condition policy; verify against your Seller Hub template before upload.
 */
const EBAY_CARD_CONDITION: Record<string, string> = {
  NM: "400010", // Near mint or better
  LP: "400011", // Excellent
  MP: "400012", // Very good
  HP: "400013", // Poor
  DMG: "400013",
};

/**
 * eBay Seller Hub Reports / File Exchange **draft** upload. Action=Draft creates unpublished drafts
 * you finish and publish yourself in Seller Hub — nothing goes live from this file.
 */
export function ebayDraftCsv(cards: Card[], s: Settings, siteUrl: string) {
  const header = [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
    "CustomLabel",
    "*Category",
    "*Title",
    "*ConditionID",
    "CD:Card Condition - (ID: 40001)",
    "CD:Professional Grader - (ID: 27501)",
    "CD:Grade - (ID: 27502)",
    "PicURL",
    "*Description",
    "*Format",
    "*Duration",
    "*StartPrice",
    "*Quantity",
    "*Location",
    "ShippingProfileName",
    "ReturnProfileName",
    "PaymentProfileName",
    "C:Game",
    "C:Card Name",
    "C:Set",
    "C:Card Number",
    "C:Year Manufactured",
    "C:Player/Athlete",
  ];
  const rows: unknown[][] = [header];
  for (const c of cards) {
    const graded = c.graded?.match(/^(\w+)\s+([\d.]+)/);
    const pics = siteUrl
      ? [`${siteUrl}/api/shop/image/${c.id}/front`, c.backImage ? `${siteUrl}/api/shop/image/${c.id}/back` : ""].filter(Boolean).join("|")
      : "";
    const desc = (c.description || renderDescription(c, s)).replace(/\n/g, "<br>");
    rows.push([
      "Draft",
      c.id,
      s.ebayCategory[c.game as keyof Settings["ebayCategory"]] ?? s.ebayCategory.Other,
      c.title || renderTitle(c, s),
      graded ? "2750" : "4000",
      graded ? "" : EBAY_CARD_CONDITION[c.condition] ?? "400010",
      graded ? graded[1].toUpperCase() : "",
      graded ? graded[2] : "",
      pics,
      desc,
      "FixedPrice",
      "GTC",
      c.listPrice?.toFixed(2) ?? "",
      c.quantity,
      s.ebayLocation,
      s.ebayShippingProfileName,
      s.ebayReturnProfileName,
      s.ebayPaymentProfileName,
      c.game === "Pokemon" ? "Pokémon TCG" : c.game === "Magic" ? "Magic: The Gathering" : "",
      c.game === "Sports" ? "" : c.name ?? "",
      c.setName ?? "",
      c.number ?? "",
      c.year ?? "",
      c.player ?? "",
    ]);
  }
  return toCsv(rows);
}

/** TCGplayer seller inventory/pricing style CSV. Only Pokemon and Magic make sense on TCGplayer. */
export function tcgplayerCsv(cards: Card[], s: Settings, siteUrl: string) {
  const header = [
    "TCGplayer Id",
    "Product Line",
    "Set Name",
    "Product Name",
    "Title",
    "Number",
    "Rarity",
    "Condition",
    "TCG Market Price",
    "TCG Marketplace Price",
    "Add to Quantity",
    "Photo URL",
  ];
  const rows: unknown[][] = [header];
  for (const c of cards) {
    const foil = /foil|holo/i.test(c.variant ?? "") && !/non-?foil/i.test(c.variant ?? "");
    const cond = `${CONDITION_LONG[c.condition] ?? "Near Mint"}${foil && c.game === "Magic" ? " Foil" : ""}`;
    rows.push([
      c.tcgplayerId ?? "",
      c.game === "Pokemon" ? "Pokemon" : "Magic",
      c.setName ?? "",
      c.name ?? "",
      c.title || renderTitle(c, s),
      c.number ?? "",
      c.rarity ?? "",
      cond,
      c.suggestedPrice?.toFixed(2) ?? "",
      c.listPrice?.toFixed(2) ?? "",
      c.quantity,
      siteUrl ? `${siteUrl}/api/shop/image/${c.id}/front` : "",
    ]);
  }
  return toCsv(rows);
}
