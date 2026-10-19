import { z } from "zod";

import { auditVerdictSchema, isoTimestampSchema } from "./common";

export const decisionContractSchema = z.object({
  leadId: z.string().min(1),
  verdict: auditVerdictSchema,
  reasons: z.array(z.string()),
  evidence: z.array(z.string()),
  score: z.number().nullable(),
  signalIds: z.array(z.string()),
  promptVersion: z.number().int().nullable(),
  modelProvider: z.string().nullable(),
  timestamp: isoTimestampSchema,
});

export type DecisionContract = z.infer<typeof decisionContractSchema>;

export function parseDecisionContract(input: unknown) {
  return decisionContractSchema.safeParse(input);
}
