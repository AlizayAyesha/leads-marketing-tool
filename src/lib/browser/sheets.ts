import type { RawLeadInput } from "@/types";

const ALIASES: Record<keyof RawLeadInput, string[]> = {
  name: ["name"],
  company: ["company"],
  website: ["website", "url", "site"],
  email: ["email"],
  phone: ["phone"],
  linkedinUrl: ["linkedin", "linkedinurl"],
  instagramUrl: ["instagram"],
  facebookUrl: ["facebook"],
  twitterUrl: ["twitter", "x"],
  source: ["source"],
  location: ["location"],
  industry: ["industry"],
  originalPost: ["original post", "originalpost", "post"],
  notes: ["notes"],
  testRecipient: ["test recipient", "testrecipient", "outreachtestmode"],
  externalRowId: ["row", "id"],
  sourceActor: ["sourceactor"],
  sourceUrl: ["sourceurl"],
};

export function tableToLeadInputs(rows: string[][]): RawLeadInput[] {
  const headers = (rows[0] ?? []).map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((row, index) => {
    const pick = (field: keyof RawLeadInput) => {
      const aliases = ALIASES[field] ?? [];
      const col = headers.findIndex((header) => aliases.includes(header));
      return col >= 0 ? row[col]?.trim() || null : null;
    };
    return {
      name: pick("name"),
      company: pick("company"),
      website: pick("website"),
      email: pick("email"),
      phone: pick("phone"),
      linkedinUrl: pick("linkedinUrl"),
      instagramUrl: pick("instagramUrl"),
      facebookUrl: pick("facebookUrl"),
      twitterUrl: pick("twitterUrl"),
      source: pick("source") ?? "google-sheets-browser",
      location: pick("location"),
      industry: pick("industry"),
      originalPost: pick("originalPost"),
      notes: pick("notes"),
      testRecipient: pick("testRecipient"),
      externalRowId: pick("externalRowId") ?? String(index + 2),
      sourceActor: "chrome",
      sourceUrl: null,
    };
  });
}

export const SHEET_ENRICHMENT_COLUMNS = [
  "Research Status",
  "Signals",
  "Opportunity",
  "Qualification",
  "Recommended Solution",
  "Outreach Status",
];
