import { z } from "zod";

import { normalizeLead } from "@/lib/leads/normalize";

const optionalText = z.union([z.string(), z.null()]).optional();

export const rawLeadInputSchema = z.object({
  name: optionalText,
  company: optionalText,
  website: optionalText,
  email: optionalText,
  phone: optionalText,
  linkedinUrl: optionalText,
  instagramUrl: optionalText,
  facebookUrl: optionalText,
  twitterUrl: optionalText,
  source: optionalText,
  location: optionalText,
  industry: optionalText,
  originalPost: optionalText,
  notes: optionalText,
  testRecipient: z.union([z.boolean(), z.string(), z.null()]).optional(),
  externalRowId: optionalText,
  sourceActor: optionalText,
  sourceUrl: optionalText,
  sourceRunId: optionalText,
  sourceDatasetId: optionalText,
  rawPayload: z.unknown().optional(),
});

export type ParsedLeadInput = z.infer<typeof rawLeadInputSchema>;

export type LeadInputParseResult =
  | { ok: true; data: ParsedLeadInput; normalized: ReturnType<typeof normalizeLead> }
  | { ok: false; code: "INVALID_SHAPE" | "EMPTY" | "INVALID_EMAIL"; error: string };

function hasIdentity(input: {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  website?: string | null;
}) {
  return Boolean(input.name || input.company || input.email || input.website);
}

function emailLooksValid(value?: string | null) {
  if (!value?.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function parseLeadInput(input: unknown): LeadInputParseResult {
  const parsed = rawLeadInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_SHAPE", error: "Lead input is not a valid record." };
  }
  if (parsed.data.email && !emailLooksValid(parsed.data.email)) {
    if (!parsed.data.name && !parsed.data.company && !parsed.data.website) {
      return { ok: false, code: "INVALID_EMAIL", error: "Email is invalid and no other identity is present." };
    }
  }
  const normalized = normalizeLead(parsed.data);
  if (!hasIdentity(normalized)) {
    return { ok: false, code: "EMPTY", error: "Lead input has no name, company, email, or website." };
  }
  return { ok: true, data: parsed.data, normalized };
}
