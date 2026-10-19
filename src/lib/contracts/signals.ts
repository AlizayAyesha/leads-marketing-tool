import { z } from "zod";

import { confidenceSchema, evidenceRefSchema, isoTimestampSchema, SIGNAL_CONTRACT_VERSION } from "./common";

export const signalKindSchema = z.enum([
  "identity",
  "company",
  "role",
  "industry",
  "website",
  "contact",
  "technology",
  "growth",
  "pain",
  "buying",
  "digital",
  "automation",
  "source",
]);

export const signalItemSchema = z.object({
  id: z.string().min(1),
  kind: signalKindSchema,
  label: z.string().min(1),
  present: z.boolean(),
  evidence: z.string(),
  confidence: confidenceSchema,
  sourceUrl: z.string().nullable(),
  rejected: z.boolean().optional(),
});

export const leadSignalsContractSchema = z.object({
  version: z.literal(SIGNAL_CONTRACT_VERSION),
  leadId: z.string().min(1),
  identity: z.object({
    name: z.string().nullable(),
    company: z.string().nullable(),
    role: z.string().nullable(),
  }),
  company: z.object({
    industry: z.string().nullable(),
    size: z.string().nullable(),
    geography: z.string().nullable(),
  }),
  website: z.object({
    url: z.string().nullable(),
    quality: z.number().nullable(),
    qualityBand: z.enum(["unknown", "poor", "fair", "good"]),
  }),
  contactChannels: z.object({
    email: z.boolean(),
    phone: z.boolean(),
    linkedin: z.boolean(),
    instagram: z.boolean(),
    facebook: z.boolean(),
    twitter: z.boolean(),
  }),
  items: z.array(signalItemSchema),
  evidence: z.array(evidenceRefSchema),
  source: z.string().nullable(),
  timestamp: isoTimestampSchema,
  legacy: z.object({
    website_exists: z.boolean(),
    website_quality: z.number().nullable(),
    website_quality_band: z.enum(["unknown", "poor", "fair", "good"]),
    has_email: z.boolean(),
    has_phone: z.boolean(),
    has_linkedin: z.boolean(),
    social_presence: z.boolean(),
    contact_available: z.boolean(),
    mentions_ai: z.boolean(),
    mentions_automation: z.boolean(),
    mentions_software: z.boolean(),
    mentions_website_need: z.boolean(),
    explicit_request: z.boolean(),
    operational_complexity: z.boolean(),
    keyword_only: z.boolean(),
    thin_record: z.boolean(),
    industry: z.string().nullable(),
    location: z.string().nullable(),
    source: z.string().nullable(),
  }),
});

export type SignalItem = z.infer<typeof signalItemSchema>;
export type LeadSignalsContract = z.infer<typeof leadSignalsContractSchema>;

export function assertSignalEvidence(item: Omit<SignalItem, "rejected" | "confidence"> & { confidence?: SignalItem["confidence"] }): SignalItem {
  const evidence = item.evidence.trim();
  if (item.present && !evidence) {
    return {
      ...item,
      present: false,
      evidence: "No evidence recorded. Signal was not asserted.",
      confidence: "unknown",
      rejected: true,
    };
  }
  return {
    ...item,
    evidence: evidence || "Not observed.",
    confidence: item.confidence ?? (item.present ? "observed" : "unknown"),
    rejected: false,
  };
}

export function parseLeadSignals(input: unknown) {
  return leadSignalsContractSchema.safeParse(input);
}
