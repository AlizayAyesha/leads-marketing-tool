import "server-only";

import type { LinkedInConnectionStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { ensureTrace, patchTrace, rememberTrace } from "@/lib/intelligence/trace";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { decideLinkedInConnectionTransition } from "@/lib/linkedin/connection/machine";
import { resolveLinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/registry";
import { countLinkedInDailyUsage } from "@/lib/linkedin/connection/usage";
import {
  LINKEDIN_CONNECT_STEP,
  LINKEDIN_CONNECTION_EVENTS,
  LINKEDIN_POST_CONNECTION_STEP,
  type LinkedInConnectionAction,
  type ConnectionMachineInput,
} from "@/lib/linkedin/connection/types";

type LeadContext = {
  id: string;
  leadId: string;
  name: string | null;
  linkedinUrl: string | null;
  suppressed: boolean;
  status: string;
};

function persistLead(lead: { id: string; leadId: string; name: string | null; linkedinUrl: string | null }) {
  return { id: lead.id, leadId: lead.leadId, name: lead.name, linkedinUrl: lead.linkedinUrl };
}

async function loadContext(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      drafts: {
        where: { channel: "LINKEDIN", status: { in: ["PENDING_APPROVAL", "EDITED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
  if (!lead) throw new Error("Lead not found.");
  const connection = await prisma.linkedInConnection.findUnique({ where: { leadId } });
  const policy = await getOutreachEnginePolicy();
  const quota = await countLinkedInDailyUsage();
  const inspected = inspectLinkedInUrl(lead.linkedinUrl);
  const audit = lead.audits[0];
  const allowedChannels = Array.isArray(audit?.allowedChannels) ? (audit.allowedChannels as string[]) : [];
  const input: ConnectionMachineInput = {
    status: connection?.status ?? "NOT_REQUESTED",
    stopped: Boolean(connection?.stoppedAt),
    suppressed: lead.suppressed,
    leadStatus: lead.status,
    auditVerdict: audit?.verdict ?? null,
    auditedAt: audit?.createdAt ?? null,
    allowedChannels,
    linkedinUrlKind: inspected.kind,
    waitDays: policy.postConnectionWaitDays,
    linkedinDraftsEnabled: policy.linkedinDrafts,
    connectedAt: connection?.connectedAt ?? null,
    nextEligibleMessageAt: connection?.nextEligibleMessageAt ?? null,
    hasPendingConnectDraft: lead.drafts.some((draft) => draft.stepKind === LINKEDIN_CONNECT_STEP && draft.status === "PENDING_APPROVAL"),
    hasPendingMessageDraft: lead.drafts.some((draft) => draft.stepKind === LINKEDIN_POST_CONNECTION_STEP && draft.status !== "REJECTED" && draft.status !== "SUPERSEDED"),
    connectionsToday: quota.connectionsToday,
    messagesToday: quota.messagesToday,
    connectionDailyCap: policy.linkedinConnectionDailyCap,
    messageDailyCap: policy.linkedinMessageDailyCap,
  };
  return { lead, connection, policy, inspected, audit, input, quota };
}

async function persistTransition(input: {
  lead: Pick<LeadContext, "id" | "leadId" | "name" | "linkedinUrl">;
  action: LinkedInConnectionAction;
  from: string;
  to: LinkedInConnectionStatus;
  code: string;
  reason: string;
  eventType: string;
  patch: Prisma.LinkedInConnectionUncheckedUpdateInput | Prisma.LinkedInConnectionUncheckedCreateInput;
  draft?: { stepKind: string; message: string; reasonForContacting: string };
  traceId?: string | null;
}) {
  const trace = input.traceId ? { id: input.traceId } : await ensureTrace(input.lead.id);
  const existing = await prisma.linkedInConnection.findUnique({ where: { leadId: input.lead.id } });
  const row = existing
    ? await prisma.linkedInConnection.update({
        where: { leadId: input.lead.id },
        data: { ...input.patch, traceId: trace.id } as Prisma.LinkedInConnectionUpdateInput,
      })
    : await prisma.linkedInConnection.create({
        data: {
          leadId: input.lead.id,
          status: input.to,
          profileUrl: input.lead.linkedinUrl,
          ...input.patch,
          traceId: trace.id,
        } as Prisma.LinkedInConnectionUncheckedCreateInput,
      });
  let draftId: string | null = null;
  if (input.draft) {
    const draft = await prisma.outreachDraft.create({
      data: {
        leadId: input.lead.id,
        channel: "LINKEDIN",
        message: input.draft.message,
        status: "PENDING_APPROVAL",
        reasonForContacting: input.draft.reasonForContacting,
        firstMessageGoal: input.draft.stepKind === LINKEDIN_CONNECT_STEP ? "Ask the operator to connect on LinkedIn. Jarvis will not send the invite." : "Post-connection message draft only. Jarvis will not send it.",
        stepKind: input.draft.stepKind,
        traceId: trace.id,
        mode: "heuristic",
      },
    });
    draftId = draft.id;
    await prisma.linkedInConnection.update({
      where: { id: row.id },
      data:
        input.draft.stepKind === LINKEDIN_CONNECT_STEP
          ? { recommendationDraftId: draft.id }
          : { messageDraftId: draft.id },
    });
  }
  await prisma.outreachEvent.create({
    data: {
      leadId: input.lead.id,
      draftId,
      type: input.eventType,
      channel: "LINKEDIN",
      payload: { from: input.from, to: input.to, code: input.code, action: input.action },
    },
  });
  await patchTrace(trace.id, { linkedinConnectionId: row.id, draftId: draftId ?? undefined });
  await writeAudit({
    action: input.eventType.toLowerCase().replace(/_/g, "."),
    entity: "linkedin_connection",
    entityId: row.id,
    payload: { leadId: input.lead.leadId, from: input.from, to: input.to, code: input.code, draftId },
  });
  await rememberTrace({
    leadId: input.lead.id,
    publicLeadId: input.lead.leadId,
    kind: "linkedin_connection",
    content: input.reason,
    traceId: trace.id,
    metadata: { status: input.to, code: input.code },
  });
  await prisma.lead.update({ where: { id: input.lead.id }, data: { lastActivityAt: new Date() } });
  return { ok: true as const, code: input.code, reason: input.reason, status: input.to, connectionId: row.id, draftId, traceId: trace.id };
}

export async function recommendLinkedInConnection(leadId: string, options: { traceId?: string | null } = {}) {
  const ctx = await loadContext(leadId);
  const decision = decideLinkedInConnectionTransition("recommend", ctx.input);
  if (!decision.ok) return { ok: false as const, code: decision.code, reason: decision.reason, status: decision.from };
  const name = ctx.lead.name || "this person";
  return persistTransition({
    lead: persistLead(ctx.lead),
    action: "recommend",
    from: decision.from,
    to: "RECOMMENDED",
    code: decision.code,
    reason: decision.reason,
    eventType: LINKEDIN_CONNECTION_EVENTS.RECOMMENDED,
    traceId: options.traceId ?? ctx.audit?.traceId ?? null,
    patch: {
      status: "RECOMMENDED",
      recommendedAt: new Date(),
      profileUrl: ctx.lead.linkedinUrl,
      normalizedUrl: ctx.inspected.normalizedUrl,
      decisionId: ctx.audit?.id ?? null,
    },
    draft: {
      stepKind: LINKEDIN_CONNECT_STEP,
      reasonForContacting: "Decision Maker PASS. Recommend a LinkedIn connection.",
      message: `Recommend connecting with ${name} on LinkedIn (${ctx.inspected.normalizedUrl}).\n\nJarvis will not send this connection request. After you approve, confirm in Jarvis once you have actually sent the invite on LinkedIn. Jarvis will not treat that as CONNECTED.`,
    },
  });
}

export async function approveLinkedInConnection(leadId: string, approvedBy = "operator") {
  const ctx = await loadContext(leadId);
  const decision = decideLinkedInConnectionTransition("approve", ctx.input);
  if (!decision.ok) return { ok: false as const, code: decision.code, reason: decision.reason, status: decision.from };
  if (ctx.connection?.recommendationDraftId) {
    await prisma.outreachDraft.updateMany({
      where: { id: ctx.connection.recommendationDraftId, status: { in: ["PENDING_APPROVAL", "EDITED"] } },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy },
    });
  }
  return persistTransition({
    lead: persistLead(ctx.lead),
    action: "approve",
    from: decision.from,
    to: "REQUEST_APPROVED",
    code: decision.code,
    reason: decision.reason,
    eventType: LINKEDIN_CONNECTION_EVENTS.APPROVED,
    patch: {
      status: "REQUEST_APPROVED",
      requestApprovedAt: new Date(),
      requestApprovedBy: approvedBy,
    },
  });
}

export async function confirmLinkedInConnectionRequested(leadId: string) {
  const ctx = await loadContext(leadId);
  const decision = decideLinkedInConnectionTransition("confirm_requested", ctx.input);
  if (!decision.ok) return { ok: false as const, code: decision.code, reason: decision.reason, status: decision.from };
  return persistTransition({
    lead: persistLead(ctx.lead),
    action: "confirm_requested",
    from: decision.from,
    to: "REQUESTED",
    code: decision.code,
    reason: decision.reason,
    eventType: LINKEDIN_CONNECTION_EVENTS.REQUESTED,
    patch: {
      status: "REQUESTED",
      connectionRequestedAt: new Date(),
    },
  });
}

export async function checkLinkedInConnectionStatus(leadId: string) {
  const ctx = await loadContext(leadId);
  const provider = await resolveLinkedInConnectionStatusProvider();
  const fetched = await provider.fetchStatus({
    profileUrl: ctx.lead.linkedinUrl || "",
    normalizedUrl: ctx.inspected.normalizedUrl || ctx.lead.linkedinUrl || "",
  });
  const decision = decideLinkedInConnectionTransition("apply_status", {
    ...ctx.input,
    providerConfigured: provider.configured,
    providerResult: fetched.result,
  });
  if (!decision.ok) {
    return { ok: false as const, code: decision.code, reason: decision.reason, status: decision.from };
  }
  const now = new Date();
  const connected = decision.to === "CONNECTED";
  const declined = decision.to === "DECLINED";
  const eventType = connected
    ? LINKEDIN_CONNECTION_EVENTS.CONNECTED
    : declined
      ? LINKEDIN_CONNECTION_EVENTS.DECLINED
      : LINKEDIN_CONNECTION_EVENTS.UNKNOWN;
  return persistTransition({
    lead: persistLead(ctx.lead),
    action: "apply_status",
    from: decision.from,
    to: decision.to,
    code: decision.code,
    reason: fetched.message ?? decision.reason,
    eventType,
    patch: {
      status: decision.to,
      lastCheckedAt: now,
      lastCheckResult: fetched.result,
      statusSource: provider.configured ? "authorized_provider" : "none",
      statusCode: fetched.code,
      connectedAt: connected ? now : ctx.connection?.connectedAt ?? null,
      declinedAt: declined ? now : ctx.connection?.declinedAt ?? null,
      nextEligibleMessageAt: connected && decision.nextEligibleMessageAt ? new Date(decision.nextEligibleMessageAt) : ctx.connection?.nextEligibleMessageAt ?? null,
      waitDays: ctx.policy.postConnectionWaitDays,
    },
  });
}

export async function recommendLinkedInPostConnectionMessage(leadId: string) {
  const ctx = await loadContext(leadId);
  const decision = decideLinkedInConnectionTransition("recommend_message", ctx.input);
  if (!decision.ok) return { ok: false as const, code: decision.code, reason: decision.reason, status: decision.from };
  const research = await prisma.linkedInResearch.findFirst({
    where: { leadId, status: "AVAILABLE" },
    orderBy: { retrievedAt: "desc" },
  });
  const site = await prisma.leadResearch.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    select: { websiteQualityNotes: true, rawSnapshot: true },
  });
  const snapshot = site?.rawSnapshot && typeof site.rawSnapshot === "object" ? (site.rawSnapshot as { title?: string | null }) : null;
  const { contextFromLead, ensureOpeningConversation } = await import("@/lib/conversation/persist");
  const { draftConversationMessage, assertNoPrematurePitch, assertNoConsulting, assertNoBrochure, assertNoPrematureBookingLink } = await import("@/lib/conversation/draft");
  const { openingConversationStage } = await import("@/lib/conversation/machine");
  const conversationCtx = contextFromLead({
    name: ctx.lead.name,
    company: ctx.lead.company,
    headline: research?.headline,
    about: research?.about,
    roleTitle: research?.roleTitle,
    websiteTitle: snapshot?.title ?? null,
  });
  const opening = openingConversationStage();
  const drafted = draftConversationMessage({ stage: "GETTING_TO_KNOW", ctx: conversationCtx });
  assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
  assertNoConsulting(drafted.message);
  assertNoBrochure(drafted.message);
  assertNoPrematureBookingLink("GETTING_TO_KNOW", drafted.message);
  await ensureOpeningConversation({ leadId, ctx: conversationCtx });
  return persistTransition({
    lead: persistLead(ctx.lead),
    action: "recommend_message",
    from: decision.from,
    to: "CONNECTED",
    code: decision.code,
    reason: opening.reason,
    eventType: LINKEDIN_CONNECTION_EVENTS.MESSAGE_RECOMMENDED,
    patch: { status: "CONNECTED" },
    draft: {
      stepKind: LINKEDIN_POST_CONNECTION_STEP,
      reasonForContacting: opening.reason,
      message: `${drafted.message}\n\nJarvis will not send this LinkedIn message.`,
    },
  });
}

export async function stopLinkedInConnectionLifecycle(leadId: string, reason: string) {
  const connection = await prisma.linkedInConnection.findUnique({ where: { leadId } });
  if (!connection || connection.stoppedAt) return { ok: true as const, skipped: true, reason };
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false as const, code: "LEAD_MISSING", reason: "Lead not found." };
  const decision = decideLinkedInConnectionTransition("stop", { status: connection.status, stopped: false });
  await prisma.linkedInConnection.update({
    where: { id: connection.id },
    data: { stoppedAt: new Date(), stopReason: reason },
  });
  await prisma.outreachEvent.create({
    data: {
      leadId,
      type: LINKEDIN_CONNECTION_EVENTS.STOPPED,
      channel: "LINKEDIN",
      payload: { reason, status: connection.status, code: decision.code },
    },
  });
  await writeAudit({
    action: "linkedin.connection.stopped",
    entity: "linkedin_connection",
    entityId: connection.id,
    payload: { reason },
  });
  return { ok: true as const, skipped: false, reason };
}

export async function maybeRecommendLinkedInConnection(leadId: string, traceId?: string | null) {
  try {
    return await recommendLinkedInConnection(leadId, { traceId });
  } catch {
    return { ok: false as const, code: "RECOMMEND_SKIPPED", reason: "Connection recommendation skipped." };
  }
}

export async function rejectLinkedInRecommendationDraft(draft: {
  id: string;
  leadId: string;
  stepKind: string | null;
  status: string;
}) {
  if (draft.stepKind !== LINKEDIN_CONNECT_STEP && draft.stepKind !== LINKEDIN_POST_CONNECTION_STEP) {
    return { ok: true as const, skipped: true };
  }
  const connection = await prisma.linkedInConnection.findUnique({ where: { leadId: draft.leadId } });
  if (!connection) return { ok: true as const, skipped: true };
  if (draft.stepKind === LINKEDIN_CONNECT_STEP && connection.status === "RECOMMENDED") {
    await prisma.linkedInConnection.update({
      where: { id: connection.id },
      data: {
        status: "NOT_REQUESTED",
        recommendedAt: null,
        recommendationDraftId: null,
      },
    });
  }
  if (draft.stepKind === LINKEDIN_POST_CONNECTION_STEP && connection.messageDraftId === draft.id) {
    await prisma.linkedInConnection.update({
      where: { id: connection.id },
      data: { messageDraftId: null },
    });
  }
  await writeAudit({
    action: "linkedin.connection.recommendation_rejected",
    entity: "linkedin_connection",
    entityId: connection.id,
    payload: {
      draftId: draft.id,
      stepKind: draft.stepKind,
      note: "Rejected recommendation does not count toward the daily LinkedIn quota. Jarvis still will not send.",
    },
  });
  return { ok: true as const, skipped: false };
}


/**
 * Chrome saw Pending on the profile (invite already out) but DB still said NOT_REQUESTED.
 * Persist REQUESTED so the next Connect wave skips this person and does not reopen the page.
 */
export async function markLinkedInInviteAlreadyPending(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, leadId: true } });
  if (!lead) return { ok: false as const, reason: "Lead not found." };
  const existing = await prisma.linkedInConnection.findUnique({ where: { leadId } });
  if (existing?.status === "CONNECTED" || existing?.status === "DECLINED") {
    return { ok: true as const, status: existing.status, skipped: true };
  }
  if (existing?.status === "REQUESTED") {
    return { ok: true as const, status: "REQUESTED" as const, skipped: true };
  }
  const now = new Date();
  await prisma.linkedInConnection.upsert({
    where: { leadId },
    create: {
      leadId,
      status: "REQUESTED",
      connectionRequestedAt: now,
      lastCheckedAt: now,
      lastCheckResult: "PENDING",
      statusSource: "authorized_provider",
      statusCode: "ALREADY_INVITED",
    },
    update: {
      status: "REQUESTED",
      connectionRequestedAt: existing?.connectionRequestedAt ?? now,
      lastCheckedAt: now,
      lastCheckResult: "PENDING",
      statusSource: "authorized_provider",
      statusCode: "ALREADY_INVITED",
      stoppedAt: null,
    },
  });
  await writeAudit({
    action: "linkedin.connection.already_pending",
    entity: "linkedin_connection",
    entityId: leadId,
    payload: { leadId: lead.leadId, status: "REQUESTED", code: "ALREADY_INVITED" },
  });
  return { ok: true as const, status: "REQUESTED" as const, skipped: false };
}

export async function recordAuthorizedLinkedInConnectionSend(
  leadId: string,
  input: { body: string; provider: string; externalId?: string | null; idempotencyKey: string },
) {
  const ctx = await loadContext(leadId);
  const decision = decideLinkedInConnectionTransition("record_authorized_send", ctx.input);
  if (!decision.ok) return { ok: false as const, code: decision.code, reason: decision.reason, status: decision.from };
  await prisma.outreachDraft.updateMany({
    where: {
      leadId: ctx.lead.id,
      channel: "LINKEDIN",
      stepKind: LINKEDIN_CONNECT_STEP,
      status: { in: ["PENDING_APPROVAL", "EDITED", "APPROVED"] },
    },
    data: { status: "SUPERSEDED" },
  });
  return persistTransition({
    lead: persistLead(ctx.lead),
    action: "record_authorized_send",
    from: decision.from,
    to: "REQUESTED",
    code: decision.code,
    reason: decision.reason,
    eventType: LINKEDIN_CONNECTION_EVENTS.SENT,
    patch: {
      status: "REQUESTED",
      connectionRequestedAt: new Date(),
    },
  });
}
