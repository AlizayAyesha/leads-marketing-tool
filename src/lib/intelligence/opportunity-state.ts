import type { LeadStatus } from "@prisma/client";

/** Sales OS on top of existing LeadStatus. Extra labels are derived, not a second pipeline. */
export const OPPORTUNITY_STATES = [
  "DISCOVERED",
  "VERIFIED",
  "QUALIFIED",
  "OPPORTUNITY",
  "RESEARCHED",
  "DRAFTED",
  "APPROVED",
  "SENT",
  "REPLIED",
  "POSITIVE",
  "MEETING",
  "PROPOSAL",
  "WON",
  "LOST",
  "NURTURE",
  "REJECTED",
  "SUPPRESSED",
] as const;

export type OpportunityState = (typeof OPPORTUNITY_STATES)[number];

export function opportunityStateFromLead(input: {
  status: LeadStatus | string;
  suppressed?: boolean;
  priority?: boolean;
  rejected?: boolean;
  nurture?: boolean;
  hasOpportunity?: boolean;
  hasDraft?: boolean;
  outcome?: {
    sent?: boolean;
    replied?: boolean;
    interested?: boolean;
    meeting?: boolean;
  } | null;
}): OpportunityState {
  if (input.suppressed || input.status === "DO_NOT_CONTACT") return "SUPPRESSED";
  if (input.rejected || input.status === "LOST") return input.status === "LOST" ? "LOST" : "REJECTED";
  if (input.status === "WON") return "WON";
  if (input.status === "PROPOSAL") return "PROPOSAL";
  if (input.status === "MEETING" || input.outcome?.meeting) return "MEETING";
  if (input.status === "INTERESTED" || input.outcome?.interested) return "POSITIVE";
  if (input.status === "REPLIED" || input.outcome?.replied) return "REPLIED";
  if (input.status === "CONTACTED" || input.outcome?.sent) return "SENT";
  if (input.status === "APPROVED") return "APPROVED";
  if (input.status === "READY_FOR_REVIEW" || input.hasDraft) return "DRAFTED";
  if (input.nurture && !input.priority) return "NURTURE";
  if (input.status === "QUALIFIED" && input.priority) return "OPPORTUNITY";
  if (input.status === "QUALIFIED") return "QUALIFIED";
  if (input.status === "RESEARCHED" || input.hasOpportunity) return input.hasOpportunity ? "OPPORTUNITY" : "RESEARCHED";
  if (input.status === "NEW") return "DISCOVERED";
  return "VERIFIED";
}
