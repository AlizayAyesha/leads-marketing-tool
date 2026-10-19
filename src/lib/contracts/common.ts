import { z } from "zod";

export const SIGNAL_CONTRACT_VERSION = 1;

export const confidenceSchema = z.enum(["observed", "inferred", "unknown"]);
export const auditVerdictSchema = z.enum(["PASS", "HOLD", "REJECT"]);
export const outreachChannelSchema = z.enum(["EMAIL", "LINKEDIN", "INSTAGRAM", "FACEBOOK", "X_TWITTER"]);
export const zarServiceSchema = z.enum([
  "WEBSITE_DEVELOPMENT",
  "FULL_STACK_DEVELOPMENT",
  "SAAS_DEVELOPMENT",
  "AI_INTEGRATION",
  "AI_AUTOMATION",
  "AI_CHATBOTS",
  "CRM_ERP_DEVELOPMENT",
  "SEO",
  "UI_UX",
  "BRANDING",
  "CUSTOM_SOFTWARE",
]);
export const draftStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EDITED",
  "SENT",
  "SUPERSEDED",
]);

export const evidenceRefSchema = z.object({
  text: z.string().min(1),
  sourceUrl: z.string().nullable(),
  confidence: confidenceSchema,
});

export const isoTimestampSchema = z.string().min(1);

export type Confidence = z.infer<typeof confidenceSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
