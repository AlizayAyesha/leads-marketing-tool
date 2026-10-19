import { createHash } from "node:crypto";

export type SheetLeadIdentity = {
  email?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  website?: string | null;
  company?: string | null;
  name?: string | null;
  externalRowId?: string | null;
};

export type SheetBatchRecord = {
  fingerprint: string;
  importedAt: string;
  usedAt: string | null;
  stored: number;
  duplicates: number;
  leadCount: number;
};

export function sheetLeadIdentityKey(lead: SheetLeadIdentity) {
  const email = String(lead.email ?? "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const linkedin = String(lead.linkedinUrl ?? "").trim().toLowerCase();
  if (linkedin) return `li:${linkedin}`;
  const twitter = String(lead.twitterUrl ?? "").trim().toLowerCase();
  if (twitter) return `x:${twitter}`;
  const rowId = String(lead.externalRowId ?? "").trim().toLowerCase();
  if (rowId) return `row:${rowId}`;
  const website = String(lead.website ?? "").trim().toLowerCase();
  if (website) return `web:${website}`;
  const company = String(lead.company ?? "").trim().toLowerCase();
  const name = String(lead.name ?? "").trim().toLowerCase();
  if (company || name) return `who:${company}:${name}`;
  return "";
}

export function fingerprintSheetIdentities(leads: SheetLeadIdentity[]) {
  const keys = leads.map(sheetLeadIdentityKey).filter(Boolean).sort();
  return createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 24);
}

export function isSheetBatchExhausted(input: {
  previous: SheetBatchRecord | null;
  fingerprint: string;
  stored: number;
  duplicates: number;
  reuse?: boolean;
}) {
  if (input.reuse) return false;
  if (!input.previous?.usedAt) return false;
  if (input.previous.fingerprint !== input.fingerprint) return false;
  if (input.stored > 0) return false;
  return input.duplicates > 0 || input.previous.leadCount > 0;
}

export const OLD_SCRAPE_DONE_MESSAGE =
  "Old scraped data is done. Need new scraped data? Add a new scrape to the Leads tab, then run again.";
