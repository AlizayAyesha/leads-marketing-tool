import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getActiveCampaignBrief } from "@/lib/campaigns/active-brief";
import type { CampaignIntent } from "@/lib/campaigns/intent";
import { inspectTwitterUrl } from "@/lib/twitter/url";
import { startOfTwitterLocalDay } from "@/lib/twitter/daily/authorize";
import { TWITTER_DM_SENT_EVENT, TWITTER_FOLLOW_SENT_EVENT } from "@/lib/twitter/daily/events";
import { shouldBlockTwitterColdDm } from "@/lib/twitter/daily/eligibility";
import { isOperatorSheetSource, wantsOurServices } from "@/lib/outreach/wants-services";

export type TwitterDailyCandidate = {
  id: string;
  leadId: string;
  name: string | null;
  company: string | null;
  twitterUrl: string;
  location: string | null;
  originalPost: string | null;
  notes: string | null;
  source: string | null;
  suppressed: boolean;
  leadStatus: string;
  auditVerdict: string | null;
  serviceNeedStatus: string | null;
  opportunitySelection: string | null;
  roleTitle: string | null;
  draftId: string | null;
  draftMessage: string | null;
  campaignBrief: CampaignIntent | null;
};

export async function countTwitterConfirmedDms(now = new Date()) {
  const since = startOfTwitterLocalDay(now);
  const [dmsToday, followsToday] = await Promise.all([
    prisma.outreachEvent.count({
      where: {
        type: TWITTER_DM_SENT_EVENT,
        channel: "X_TWITTER",
        createdAt: { gte: since },
      },
    }),
    prisma.outreachEvent.count({
      where: {
        type: TWITTER_FOLLOW_SENT_EVENT,
        channel: "X_TWITTER",
        createdAt: { gte: since },
      },
    }),
  ]);
  return {
    dmsToday,
    followsToday,
  };
}

export async function loadTwitterDailyAttemptedKeys(now = new Date()) {
  const since = startOfTwitterLocalDay(now);
  const rows = await prisma.outreachEvent.findMany({
    where: {
      channel: "X_TWITTER",
      createdAt: { gte: since },
      type: { in: [TWITTER_DM_SENT_EVENT, "SKIPPED", "FAILED"] },
    },
    select: { payload: true },
    take: 500,
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
    const key = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null;
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * X DM candidates: Decision Maker PASS, or operator-nominated sheet/CSV/manual buyers.
 * Discover junk still needs PASS. Agency / tech peers always blocked.
 * Never re-DM: prior TWITTER_DM_SENT (ever), said no / DNC, or already contacted.
 */
export async function loadTwitterDailyCandidates(now = new Date(), limit = 25): Promise<TwitterDailyCandidate[]> {
  const brief = await getActiveCampaignBrief();
  const already = await prisma.outreachEvent.findMany({
    where: {
      type: TWITTER_DM_SENT_EVENT,
      channel: "X_TWITTER",
    },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  const sentLeadIds = new Set(already.map((row) => row.leadId));

  const declined = await prisma.outreachReply.findMany({
    where: {
      channel: "X_TWITTER",
      intent: { in: ["NOT_INTERESTED", "UNSUBSCRIBE", "WRONG_PERSON"] },
    },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  const declinedLeadIds = new Set(declined.map((row) => row.leadId));

  const leadInclude = {
    audits: { orderBy: { createdAt: "desc" }, take: 1 },
    opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
    drafts: {
      where: { channel: "X_TWITTER", status: { in: ["PENDING_APPROVAL", "APPROVED", "EDITED", "DRAFT"] } },
      orderBy: { createdAt: "desc" },
      take: 1,
    },
  } satisfies Prisma.LeadInclude;

  const baseWhere: Prisma.LeadWhereInput = {
    suppressed: false,
    status: { notIn: ["DO_NOT_CONTACT", "LOST", "WON", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "PROPOSAL"] },
    twitterUrl: { not: null },
  };

  // Prefer operator-nominated sheet/CSV/manual rows (same buyer filter as LinkedIn).
  const [nominatedLeads, otherLeads] = await Promise.all([
    prisma.lead.findMany({
      where: {
        ...baseWhere,
        OR: [
          { source: { contains: "sheet", mode: "insensitive" } },
          { source: { contains: "spreadsheet", mode: "insensitive" } },
          { source: { contains: "workbook", mode: "insensitive" } },
          { source: { equals: "csv", mode: "insensitive" } },
          { source: { equals: "manual", mode: "insensitive" } },
        ],
      },
      orderBy: { lastActivityAt: "desc" },
      take: 80,
      include: leadInclude,
    }),
    prisma.lead.findMany({
      where: baseWhere,
      orderBy: { lastActivityAt: "desc" },
      take: 120,
      include: leadInclude,
    }),
  ]);

  const seen = new Set<string>();
  const leads = [...nominatedLeads, ...otherLeads].filter((lead) => {
    if (seen.has(lead.id)) return false;
    seen.add(lead.id);
    return true;
  });

  const out: TwitterDailyCandidate[] = [];
  for (const lead of leads) {
    const gate = shouldBlockTwitterColdDm({
      suppressed: lead.suppressed,
      leadStatus: lead.status,
      alreadyDmSent: sentLeadIds.has(lead.id),
      negativeReply: declinedLeadIds.has(lead.id),
    });
    if (gate.block) continue;

    const url = inspectTwitterUrl(lead.twitterUrl);
    if (url.kind !== "person" || !url.url) continue;
    const audit = lead.audits[0];
    const verdict = audit?.verdict ?? null;
    const nominated = isOperatorSheetSource(lead.source);
    // Discover / research junk still needs PASS. Sheet buyers may skip that gate.
    if (!nominated && verdict !== "PASS") continue;

    const wants = wantsOurServices({
      name: lead.name,
      company: lead.company,
      industry: lead.industry,
      website: lead.website,
      location: lead.location,
      twitterUrl: url.url,
      roleTitle: lead.name,
      originalPost: lead.originalPost,
      notes: lead.notes,
      source: lead.source,
      serviceNeedStatus: audit?.serviceNeedStatus ?? null,
      opportunitySelection: lead.opportunities[0]?.selection ?? null,
      channel: "X_TWITTER",
      nominatedConnection: nominated,
      campaignBrief: brief,
    });
    if (!wants.ok) continue;

    const draft = lead.drafts[0] ?? null;
    out.push({
      id: lead.id,
      leadId: lead.leadId,
      name: lead.name,
      company: lead.company,
      twitterUrl: url.url,
      location: lead.location,
      originalPost: lead.originalPost,
      notes: lead.notes,
      source: lead.source,
      suppressed: lead.suppressed,
      leadStatus: lead.status,
      auditVerdict: verdict,
      serviceNeedStatus: audit?.serviceNeedStatus ?? null,
      opportunitySelection: lead.opportunities[0]?.selection ?? null,
      roleTitle: lead.name,
      draftId: draft?.id ?? null,
      draftMessage: draft?.message ?? null,
      campaignBrief: brief,
    });
    if (out.length >= limit) break;
  }
  return out;
}
