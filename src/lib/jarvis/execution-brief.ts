import "server-only";

import { productionLeadWhere } from "@/lib/analytics/production";
import { getIntelligenceDashboard } from "@/lib/analytics/intelligence-dashboard";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_MIN_COMMERCIAL_SCORE } from "@/lib/outreach/quality";
import { countSentToday, getOutreachEnginePolicy } from "@/lib/outreach/sequence";

export type ExecutionSnapshot = {
  researchedToday: number;
  decisionMakerPassToday: number;
  pendingDrafts: number;
  activeSequences: number;
  sentToday: number;
  dailySendLimit: number;
  repliesToday: number;
  commercialApproveQueueHint: number;
  killSwitchOn: boolean;
  sendMode: string;
  twitterDailyOutreach: boolean;
  linkedinDailyOutreach: boolean;
  twitterApprovedQueued: number;
  linkedinApprovedQueued: number;
  funnelLeads: number;
  funnelQualified: number;
  meetings: number;
  text: string;
};

export async function buildExecutionSnapshot(): Promise<ExecutionSnapshot> {
  const production = productionLeadWhere();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [policy, sentToday, sequences, pending, repliesToday, twitterApproved, linkedInApproved, dash, commercialHint] =
    await Promise.all([
      getOutreachEnginePolicy(),
      countSentToday(),
      prisma.outreachSequence.count({ where: { status: "ACTIVE", lead: production } }),
      prisma.outreachDraft.count({
        where: {
          status: { in: ["PENDING_APPROVAL", "EDITED"] },
          NOT: { stepKind: "TEST_TRANSPORT" },
          lead: production,
        },
      }),
      prisma.outreachReply.count({ where: { lead: production, createdAt: { gte: start } } }),
      prisma.outreachDraft.count({
        where: {
          channel: "X_TWITTER",
          status: "APPROVED",
          NOT: { stepKind: "TEST_TRANSPORT" },
          lead: production,
        },
      }),
      prisma.outreachDraft.count({
        where: {
          channel: "LINKEDIN",
          status: "APPROVED",
          NOT: { stepKind: "TEST_TRANSPORT" },
          lead: production,
        },
      }),
      getIntelligenceDashboard(),
      prisma.leadScore.count({
        where: { score: { gte: DEFAULT_MIN_COMMERCIAL_SCORE }, lead: production, createdAt: { gte: start } },
      }),
    ]);

  const sendLine = policy.sendsPaused
    ? "Kill switch ON. Nothing extra is emailed until sending is turned on."
    : `Send mode is ${policy.sendMode.replaceAll("_", " ")}. Gmail still requires commercial ≥${DEFAULT_MIN_COMMERCIAL_SCORE}.`;

  const text = [
    `LIVE POSTGRES (overrides doctrine). PRIORITY opportunities: ${dash.selection.priority} (NURTURE ${dash.selection.nurture}, REJECT ${dash.selection.rejected}). Researched today: ${dash.today.researched}. Decision Maker PASS today: ${dash.today.qualifiedPass}. Scores ≥${DEFAULT_MIN_COMMERCIAL_SCORE} recorded today: ${commercialHint}.`,
    `Active sequences: ${sequences}. Drafts waiting approval: ${pending}. Marked sent today: ${sentToday}/${policy.dailySendLimit}. Replies today: ${repliesToday}.`,
    sendLine,
    `X daily outreach ${policy.twitterDailyOutreach ? "ON" : "OFF"} (${twitterApproved} approved X drafts queued). LinkedIn daily ${policy.linkedinDailyOutreach ? "ON" : "OFF"} (${linkedInApproved} approved LinkedIn drafts queued).`,
    `Funnel: ${dash.funnel.leads} leads, ${dash.funnel.qualified} DM PASS ever, ${dash.funnel.meetings} meetings. Pending approvals total: ${dash.attention.pendingDrafts}.`,
    "External send only via existing sendApprovedDraft after gates. Chat/voice is not a second send path.",
  ].join(" ");

  return {
    researchedToday: dash.today.researched,
    decisionMakerPassToday: dash.today.qualifiedPass,
    pendingDrafts: pending,
    activeSequences: sequences,
    sentToday,
    dailySendLimit: policy.dailySendLimit,
    repliesToday,
    commercialApproveQueueHint: commercialHint,
    killSwitchOn: policy.sendsPaused,
    sendMode: policy.sendMode,
    twitterDailyOutreach: policy.twitterDailyOutreach,
    linkedinDailyOutreach: policy.linkedinDailyOutreach,
    twitterApprovedQueued: twitterApproved,
    linkedinApprovedQueued: linkedInApproved,
    funnelLeads: dash.funnel.leads,
    funnelQualified: dash.funnel.qualified,
    meetings: dash.funnel.meetings,
    text,
  };
}

export async function buildExecutionBrief() {
  const snap = await buildExecutionSnapshot();
  return snap.text;
}
