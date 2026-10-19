import "server-only";

import { productionLeadWhere } from "@/lib/analytics/production";
import { prisma } from "@/lib/db/prisma";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import {
  linkedInProspectEligibility,
  type LinkedInProspectCandidate,
} from "@/lib/linkedin/connection/ranking";
import { LINKEDIN_CONNECT_STEP } from "@/lib/linkedin/connection/types";

export type LinkedInLeadBlocker = {
  id: string;
  leadId: string;
  name: string | null;
  company: string | null;
  linkedinUrl: string | null;
  status: string;
  audit: string;
  research: string;
  opportunity: boolean;
  connectionStatus: string;
  code: string;
  reason: string;
  sendable: boolean;
};

export async function listLinkedInLeadBlockers(limit = 25): Promise<LinkedInLeadBlocker[]> {
  const leads = await prisma.lead.findMany({
    where: {
      AND: [productionLeadWhere()],
      linkedinUrl: { not: null },
      suppressed: false,
    },
    include: {
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      linkedinResearch: { orderBy: { retrievedAt: "desc" }, take: 1 },
      linkedinConnections: { take: 1 },
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      drafts: {
        where: {
          channel: "LINKEDIN",
          stepKind: LINKEDIN_CONNECT_STEP,
          status: { in: ["PENDING_APPROVAL", "EDITED"] },
        },
        take: 1,
      },
    },
    orderBy: { lastActivityAt: "desc" },
    take: limit,
  });

  return leads.map((lead) => {
    const audit = lead.audits[0];
    const candidate: LinkedInProspectCandidate = {
      id: lead.id,
      leadId: lead.leadId,
      name: lead.name,
      company: lead.company,
      linkedinUrl: lead.linkedinUrl,
      qualificationScore: lead.scores[0]?.score ?? null,
      auditVerdict: audit?.verdict ?? null,
      auditedAt: audit?.createdAt ?? null,
      allowedChannels: Array.isArray(audit?.allowedChannels) ? (audit.allowedChannels as string[]) : [],
      suppressed: lead.suppressed,
      leadStatus: lead.status,
      linkedinUrlKind: inspectLinkedInUrl(lead.linkedinUrl).kind,
      connectionStatus: lead.linkedinConnections[0]?.status ?? "NOT_REQUESTED",
      stopped: Boolean(lead.linkedinConnections[0]?.stoppedAt),
      linkedinResearchStatus: lead.linkedinResearch[0]?.status ?? null,
      hasOpportunity: Boolean(lead.opportunities[0]),
      hasPendingDraft: lead.drafts.length > 0,
      source: lead.source,
      roleTitle: lead.linkedinResearch[0]?.roleTitle ?? lead.linkedinResearch[0]?.headline ?? null,
      serviceNeedStatus: audit?.serviceNeedStatus ?? null,
      opportunitySelection: lead.opportunities[0]?.selection ?? null,
      originalPost: lead.originalPost,
      notes: lead.notes,
      industry: lead.industry,
      website: lead.website,
      location: lead.location ?? lead.linkedinResearch[0]?.location ?? null,
    };
    const gate = linkedInProspectEligibility(candidate, "connection_send");
    return {
      id: lead.id,
      leadId: lead.leadId,
      name: lead.name,
      company: lead.company,
      linkedinUrl: lead.linkedinUrl,
      status: lead.status,
      audit: audit?.verdict ?? "NONE",
      research: lead.linkedinResearch[0]?.status ?? "NONE",
      opportunity: Boolean(lead.opportunities[0]),
      connectionStatus: candidate.connectionStatus ?? "NOT_REQUESTED",
      code: gate.code,
      reason: gate.reason,
      sendable: gate.ok,
    };
  });
}
