import { getBusinessProfile } from "@/lib/business/profile";
import type { RankedLinkedInProspect } from "@/lib/linkedin/connection/ranking";

export function composeLinkedInConnectionNote(prospect: RankedLinkedInProspect) {
  const company = prospect.company?.trim();
  if (company) {
    return `Hi — I work with teams at ${getBusinessProfile().businessName} on software and AI systems. ${company} looked relevant. Happy to connect.`;
  }
  return `Hi — I work with teams at ${getBusinessProfile().businessName} on software and AI systems. Happy to connect.`;
}

export function composeLinkedInFollowUpMessage(prospect: RankedLinkedInProspect) {
  const who = prospect.name?.trim().split(/\s+/)[0] || "there";
  return `Hey ${who}, great to connect. Hope you're having a good week.`;
}
