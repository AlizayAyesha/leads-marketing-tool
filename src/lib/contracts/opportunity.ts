import { z } from "zod";

import { confidenceSchema, evidenceRefSchema, isoTimestampSchema, zarServiceSchema } from "./common";
import { SIGNAL_CONTRACT_VERSION } from "./common";

export const opportunityContractSchema = z.object({
  leadId: z.string().min(1),
  problem: z.string().min(1),
  evidence: z.array(evidenceRefSchema).min(1),
  recommendedService: zarServiceSchema.nullable(),
  confidence: confidenceSchema,
  score: z.number().min(0).max(100),
  source: z.string().nullable(),
  timestamp: isoTimestampSchema,
  signalVersion: z.number().int().positive(),
  opportunityKey: z.string().min(1),
});

export type OpportunityContract = z.infer<typeof opportunityContractSchema>;

const GENERIC_WEBSITE = /\bcompan(y|ies)\s+needs?\s+a\s+website\b/i;

export function isGenericWebsiteProblem(problem: string) {
  return GENERIC_WEBSITE.test(problem);
}

export function parseOpportunityContract(input: unknown) {
  const parsed = opportunityContractSchema.safeParse(input);
  if (!parsed.success) return parsed;
  if (isGenericWebsiteProblem(parsed.data.problem)) {
    return opportunityContractSchema.safeParse({
      ...parsed.data,
      problem: "",
    });
  }
  return parsed;
}

export function defaultSignalVersion() {
  return SIGNAL_CONTRACT_VERSION;
}
