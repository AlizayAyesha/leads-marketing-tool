import "server-only";

import type { LeadStatus, Prisma } from "@prisma/client";

import { productionLeadWhere } from "@/lib/analytics/production";
import { getActiveCampaignBrief } from "@/lib/campaigns/active-brief";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import {
  recommendLinkedInConnection,
  recommendLinkedInPostConnectionMessage,
} from "@/lib/linkedin/connection/lifecycle";
import { countLinkedInDailyUsage } from "@/lib/linkedin/connection/usage";
import {
  rankLinkedInProspects,
  type LinkedInProspectCandidate,
} from "@/lib/linkedin/connection/ranking";
import { LINKEDIN_CONNECT_STEP, LINKEDIN_POST_CONNECTION_STEP } from "@/lib/linkedin/connection/types";

const CLOSED: LeadStatus[] = ["DO_NOT_CONTACT", "LOST", "WON", "REPLIED", "INTERESTED", "MEETING", "PROPOSAL"];
const OVERFETCH = 80;
const NOMINATED_SOURCE_FILTER: Prisma.LeadWhereInput = {
  OR: [
    { source: { contains: "sheet", mode: "insensitive" } },
    { source: { contains: "spreadsheet", mode: "insensitive" } },
    { source: { contains: "workbook", mode: "insensitive" } },
    { source: { equals: "csv", mode: "insensitive" } },
    { source: { equals: "manual", mode: "insensitive" } },
    { source: { equals: "linkedin_connect_buyers", mode: "insensitive" } },
  ],
};

function whyNowCount(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).filter((item) => Boolean(item)).length;
}

function startOfLocalDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function listLinkedInProspectQueue(
  now = new Date(),
  mode: "recommend" | "send" = "recommend",
) {
  const quota = await countLinkedInDailyUsage(now);
  const [connectionCandidates, messageCandidates] = await Promise.all([
    loadConnectionCandidates(now, mode),
    loadMessageCandidates(now),
  ]);
  return {
    quota,
    connections: rankLinkedInProspects(connectionCandidates, {
      purpose: mode === "send" ? "connection_send" : "connection",
      limit: quota.connectionsRemaining,
      now,
    }),
    messages: rankLinkedInProspects(messageCandidates, {
      purpose: "message",
      limit: quota.messagesRemaining,
      now,
    }),
    connectionCandidates,
  };
}

export async function fillLinkedInDailyQueue() {
  const preview = await listLinkedInProspectQueue();
  const connections = await recommendRanked(preview.connections, "connection");
  const messages = await recommendRanked(preview.messages, "message");
  const next = await countLinkedInDailyUsage();
  await writeAudit({
    action: "linkedin.queue.fill",
    entity: "linkedin_connection",
    payload: {
      rankedConnections: preview.connections.map((item) => item.leadId),
      rankedMessages: preview.messages.map((item) => item.leadId),
      recommendedConnections: connections.recommended,
      skippedConnections: connections.skipped,
      recommendedMessages: messages.recommended,
      skippedMessages: messages.skipped,
      remaining: {
        connections: next.connectionsRemaining,
        messages: next.messagesRemaining,
      },
      note: "Ranked prospect queue for drafts/recommendations. Live LinkedIn send is Home → channel buttons.",
    },
  });
  return {
    ok: true as const,
    quota: next,
    connections,
    messages,
    ranked: { connections: preview.connections, messages: preview.messages },
    reason: `Queued ${connections.recommended} connection recommendation(s) and ${messages.recommended} message draft(s). Remaining ${next.connectionsRemaining} connections · ${next.messagesRemaining} messages. Send from Home.`,
  };
}

async function recommendRanked(
  ranked: Awaited<ReturnType<typeof listLinkedInProspectQueue>>["connections"],
  purpose: "connection" | "message",
) {
  const out = { recommended: 0, skipped: 0, blocked: [] as string[] };
  for (const prospect of ranked) {
    const result =
      purpose === "connection"
        ? await recommendLinkedInConnection(prospect.id)
        : await recommendLinkedInPostConnectionMessage(prospect.id);
    if (result.ok) out.recommended += 1;
    else {
      out.skipped += 1;
      out.blocked.push(`${prospect.leadId}: ${result.reason}`);
      if (result.code === "LINKEDIN_CONNECTION_DAILY_CAP" || result.code === "LINKEDIN_MESSAGE_DAILY_CAP") break;
    }
  }
  return out;
}

async function rejectedLeadIdsToday(stepKind: string, now = new Date()) {
  const rows = await prisma.outreachDraft.findMany({
    where: {
      channel: "LINKEDIN",
      stepKind,
      status: "REJECTED",
      createdAt: { gte: startOfLocalDay(now) },
    },
    select: { leadId: true },
  });
  return new Set(rows.map((row) => row.leadId));
}

async function loadConnectionCandidates(
  now = new Date(),
  mode: "recommend" | "send" = "recommend",
): Promise<LinkedInProspectCandidate[]> {
  const rejectedToday = await rejectedLeadIdsToday(LINKEDIN_CONNECT_STEP, now);
  const brief = await getActiveCampaignBrief();
  const statusFilter: Prisma.LeadWhereInput =
    mode === "send"
      ? {
          OR: [
            { linkedinConnections: { none: {} } },
            {
              linkedinConnections: {
                some: {
                  status: { in: ["NOT_REQUESTED", "RECOMMENDED", "REQUEST_APPROVED"] },
                  stoppedAt: null,
                },
              },
            },
          ],
        }
      : {
          OR: [
            { linkedinConnections: { none: {} } },
            { linkedinConnections: { some: { status: "NOT_REQUESTED", stoppedAt: null } } },
          ],
        };
  const baseWhere: Prisma.LeadWhereInput = {
    suppressed: false,
    linkedinUrl: { not: null },
    status: { notIn: CLOSED },
    AND: [productionLeadWhere(), statusFilter],
  };
  const include = {
    audits: { orderBy: { createdAt: "desc" as const }, take: 1 },
    scores: { orderBy: { createdAt: "desc" as const }, take: 1 },
    opportunities: { orderBy: { createdAt: "desc" as const }, take: 1 },
    linkedinResearch: { orderBy: { retrievedAt: "desc" as const }, take: 1 },
    linkedinConnections: { take: 1 },
    conversations: { orderBy: { updatedAt: "desc" as const }, take: 1 },
    drafts: {
      where: { channel: "LINKEDIN" as const, stepKind: LINKEDIN_CONNECT_STEP, status: { in: ["PENDING_APPROVAL", "EDITED"] } },
      take: 1,
    },
  } satisfies Prisma.LeadInclude;
  const nominated = await prisma.lead.findMany({
    where: { ...baseWhere, AND: [...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []), NOMINATED_SOURCE_FILTER] },
    include,
    orderBy: { lastActivityAt: "desc" },
    take: OVERFETCH,
  });
  const rest = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      id: { notIn: nominated.map((lead) => lead.id) },
    },
    include,
    orderBy: { lastActivityAt: "desc" },
    take: Math.max(0, OVERFETCH - nominated.length),
  });
  const leads = [...nominated, ...rest];
  return leads.map((lead) => {
    const audit = lead.audits[0];
    return {
      id: lead.id,
      leadId: lead.leadId,
      name: lead.name,
      company: lead.company,
      linkedinUrl: lead.linkedinUrl,
      qualificationScore: lead.scores[0]?.score ?? null,
      temperature: lead.temperature,
      auditVerdict: audit?.verdict ?? null,
      auditedAt: audit?.createdAt ?? null,
      allowedChannels: Array.isArray(audit?.allowedChannels) ? (audit.allowedChannels as string[]) : [],
      suppressed: lead.suppressed,
      leadStatus: lead.status,
      linkedinUrlKind: inspectLinkedInUrl(lead.linkedinUrl).kind,
      connectionStatus: lead.linkedinConnections[0]?.status ?? "NOT_REQUESTED",
      stopped: Boolean(lead.linkedinConnections[0]?.stoppedAt),
      rejectedToday: rejectedToday.has(lead.id),
      linkedinResearchStatus: lead.linkedinResearch[0]?.status ?? null,
      hasOpportunity: Boolean(lead.opportunities[0]),
      hasPendingDraft: lead.drafts.length > 0,
      conversationHeat: lead.conversations[0]?.heat ?? null,
      conversationStage: lead.conversations[0]?.stage ?? null,
      intentScore: lead.conversations[0]?.intentScore ?? 0,
      whyNowCount: whyNowCount(lead.conversations[0]?.whyNow),
      source: [lead.source, lead.linkedinResearch[0]?.source].filter(Boolean).join(" ") || null,
      roleTitle: lead.linkedinResearch[0]?.roleTitle ?? lead.linkedinResearch[0]?.headline ?? null,
      serviceNeedStatus: audit?.serviceNeedStatus ?? null,
      opportunitySelection: lead.opportunities[0]?.selection ?? null,
      originalPost: lead.originalPost,
      notes: lead.notes,
      industry: lead.industry,
      website: lead.website,
      location: lead.location ?? lead.linkedinResearch[0]?.location ?? null,
      campaignBrief: brief,
    };
  });
}

async function loadMessageCandidates(now = new Date()): Promise<LinkedInProspectCandidate[]> {
  const rejectedToday = await rejectedLeadIdsToday(LINKEDIN_POST_CONNECTION_STEP, now);
  const brief = await getActiveCampaignBrief();
  const connections = await prisma.linkedInConnection.findMany({
    where: {
      status: "CONNECTED",
      stoppedAt: null,
      OR: [{ nextEligibleMessageAt: { lte: now } }, { nextEligibleMessageAt: null }],
      lead: { suppressed: false, status: { notIn: CLOSED }, AND: [productionLeadWhere()] },
    },
    include: {
      lead: {
        include: {
          audits: { orderBy: { createdAt: "desc" }, take: 1 },
          scores: { orderBy: { createdAt: "desc" }, take: 1 },
          opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
          linkedinResearch: { orderBy: { retrievedAt: "desc" }, take: 1 },
          drafts: {
            where: { channel: "LINKEDIN", stepKind: LINKEDIN_POST_CONNECTION_STEP, status: { in: ["PENDING_APPROVAL", "EDITED"] } },
            take: 1,
          },
          conversations: { orderBy: { updatedAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { nextEligibleMessageAt: "asc" },
    take: OVERFETCH,
  });
  return connections.map((row) => {
    const audit = row.lead.audits[0];
    return {
      id: row.lead.id,
      leadId: row.lead.leadId,
      name: row.lead.name,
      company: row.lead.company,
      linkedinUrl: row.lead.linkedinUrl,
      qualificationScore: row.lead.scores[0]?.score ?? null,
      temperature: row.lead.temperature,
      auditVerdict: audit?.verdict ?? null,
      auditedAt: audit?.createdAt ?? null,
      allowedChannels: Array.isArray(audit?.allowedChannels) ? (audit.allowedChannels as string[]) : [],
      suppressed: row.lead.suppressed,
      leadStatus: row.lead.status,
      linkedinUrlKind: inspectLinkedInUrl(row.lead.linkedinUrl).kind,
      connectionStatus: row.status,
      stopped: Boolean(row.stoppedAt),
      rejectedToday: rejectedToday.has(row.leadId),
      linkedinResearchStatus: row.lead.linkedinResearch[0]?.status ?? null,
      hasOpportunity: Boolean(row.lead.opportunities[0]),
      hasPendingDraft: row.lead.drafts.length > 0,
      nextEligibleMessageAt: row.nextEligibleMessageAt,
      conversationHeat: row.lead.conversations[0]?.heat ?? null,
      conversationStage: row.lead.conversations[0]?.stage ?? null,
      intentScore: row.lead.conversations[0]?.intentScore ?? 0,
      whyNowCount: whyNowCount(row.lead.conversations[0]?.whyNow),
      source: [row.lead.source, row.lead.linkedinResearch[0]?.source].filter(Boolean).join(" ") || null,
      roleTitle: row.lead.linkedinResearch[0]?.roleTitle ?? row.lead.linkedinResearch[0]?.headline ?? null,
      serviceNeedStatus: audit?.serviceNeedStatus ?? null,
      opportunitySelection: row.lead.opportunities[0]?.selection ?? null,
      originalPost: row.lead.originalPost,
      notes: row.lead.notes,
      industry: row.lead.industry,
      website: row.lead.website,
      location: row.lead.location ?? row.lead.linkedinResearch[0]?.location ?? null,
      campaignBrief: brief,
    };
  });
}


export async function loadLinkedInDailyCandidates(now = new Date()) {
  const [connectionCandidates, messageCandidates] = await Promise.all([
    loadConnectionCandidates(now, "send"),
    loadMessageCandidates(now),
  ]);
  return { connectionCandidates, messageCandidates };
}
