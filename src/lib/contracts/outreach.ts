import { z } from "zod";

import { draftStatusSchema, outreachChannelSchema } from "./common";

export const outreachActionContractSchema = z.object({
  leadId: z.string().min(1),
  channel: outreachChannelSchema,
  draft: z.object({
    subject: z.string().nullable(),
    message: z.string().min(1),
  }),
  evidenceRefs: z.array(z.string()),
  decisionId: z.string().nullable(),
  approvalStatus: draftStatusSchema,
  promptVersion: z.number().int().nullable(),
});

export type OutreachActionContract = z.infer<typeof outreachActionContractSchema>;

export function parseOutreachAction(input: unknown) {
  return outreachActionContractSchema.safeParse(input);
}
