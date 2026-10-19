import type { EvidenceClaim } from "@/lib/intelligence/evidence";
import type { CommercialProspect } from "@/lib/intelligence/commercial";

export function prospectFromLeadFields(input: {
  company?: string | null;
  industry?: string | null;
  location?: string | null;
  website?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  name?: string | null;
  notes?: string | null;
  originalPost?: string | null;
  roleTitle?: string | null;
  suppressed?: boolean;
  evidence?: EvidenceClaim[];
}): CommercialProspect {
  return {
    company: input.company,
    industry: input.industry,
    location: input.location,
    website: input.website,
    email: input.email,
    linkedinUrl: input.linkedinUrl,
    instagramUrl: input.instagramUrl,
    roleTitle: input.roleTitle ?? null,
    notes: [input.notes, input.name].filter(Boolean).join("\n"),
    originalPost: input.originalPost,
    suppressed: input.suppressed,
    evidence: input.evidence,
  };
}
