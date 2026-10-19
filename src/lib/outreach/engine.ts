import "server-only";

import { prisma } from "@/lib/db/prisma";
import { readSuppressionState, writeAudit } from "@/lib/db/settings";
import { getAgent } from "@/lib/agents/registry";
import { runLeadPipeline } from "@/lib/pipeline/run";
import { getGoogleClient } from "@/lib/data-sources/google";
import { google } from "googleapis";
import { importFromConfiguredSheet } from "@/lib/google/sync";
import { commandForbidsSending } from "@/lib/intelligence/approval";
import { classifyIntent, classifyReply, suggestedReply, type ReplyIntent } from "@/lib/outreach/replies";
import { canEnterOutreach } from "@/lib/outreach/gate";
import {
  claimDueSequenceStep,
  enrollSequence,
  getOutreachEnginePolicy,
  stopSequence,
  stopSequencesForLead,
} from "@/lib/outreach/sequence";
import { sendApprovedDraft } from "@/lib/outreach/send";
import type { SequenceStepKind } from "@/lib/outreach/policy";

export type OutreachEngineResult = {
  imported: boolean;
  scanned: number;
  passed: number;
  held: number;
  rejected: number;
  enrolled: number;
  drafts: number;
  sent: number;
  replies: number;
  stopped: number;
  escalated: number;
  blocked: string[];
  leadIds: string[];
};

const EMPTY: OutreachEngineResult = {
  imported: false,
  scanned: 0,
  passed: 0,
  held: 0,
  rejected: 0,
  enrolled: 0,
  drafts: 0,
  sent: 0,
  replies: 0,
  stopped: 0,
  escalated: 0,
  blocked: [],
  leadIds: [],
};

export async function runOutreachEngine(input: {
  limit?: number;
  importSheet?: boolean;
  command?: string;
  leadIds?: string[];
}) {
  const policy = await getOutreachEnginePolicy();
  const result: OutreachEngineResult = { ...EMPTY, blocked: [], leadIds: [] };
  if (!policy.enabled) {
    result.blocked.push("Outreach engine is off.");
    return result;
  }
  const forbidSend = commandForbidsSending(input.command ?? "");
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

  if (input.importSheet) {
    try {
      await importFromConfiguredSheet({ limit });
      result.imported = true;
    } catch (error) {
      result.blocked.push(error instanceof Error ? error.message : "Sheet import failed.");
    }
  }

  const leads = input.leadIds?.length
    ? await prisma.lead.findMany({
        where: { leadId: { in: input.leadIds } },
      })
    : await prisma.lead.findMany({
        where: {
          suppressed: false,
          status: { notIn: ["DO_NOT_CONTACT", "LOST", "WON", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "PROPOSAL"] },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
  result.scanned = leads.length;

  for (const lead of leads) {
    await runLeadPipeline(lead.id, { engine: true });
    const fresh = await prisma.lead.findUnique({
      where: { id: lead.id },
      include: {
        audits: { orderBy: { createdAt: "desc" }, take: 1 },
        drafts: { where: { status: { in: ["PENDING_APPROVAL", "EDITED", "APPROVED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!fresh) continue;
    const verdict = fresh.audits[0]?.verdict ?? null;
    if (verdict === "PASS") result.passed += 1;
    else if (verdict === "HOLD") result.held += 1;
    else if (verdict === "REJECT") result.rejected += 1;
    const eligibility = canEnterOutreach({
      verdict,
      auditedAt: fresh.audits[0]?.createdAt,
      suppressed: fresh.suppressed,
      leadStatus: fresh.status,
      purpose: "sequence",
    });
    if (!eligibility.ok || !fresh.drafts[0]) {
      if (!eligibility.ok && verdict && verdict !== "PASS") {
        result.blocked.push(`${fresh.leadId}: ${eligibility.reason}`);
      }
      continue;
    }
    const suppression = await readSuppressionState({
      email: fresh.email,
      websiteHost: fresh.websiteHost,
      phone: fresh.phone,
    });
    const enrolled = await enrollSequence({
      leadId: fresh.id,
      channel: fresh.drafts[0].channel,
      auditVerdict: verdict,
      auditedAt: fresh.audits[0]?.createdAt,
      leadStatus: fresh.status,
      suppressed: fresh.suppressed || suppression === "suppressed",
      unsubscribed: suppression === "suppressed",
      suppressionUnknown: suppression === "unknown",
      draftId: fresh.drafts[0].id,
    });
    if (enrolled.ok) {
      result.enrolled += 1;
      result.drafts += 1;
      result.leadIds.push(fresh.leadId);
      await prisma.lead.update({
        where: { id: fresh.id },
        data: { status: fresh.status === "READY_FOR_REVIEW" ? "READY_FOR_REVIEW" : "QUALIFIED", lastActivityAt: new Date() },
      });
    } else if (enrolled.code === "DUPLICATE_SEQUENCE") {
      result.leadIds.push(fresh.leadId);
    } else {
      result.blocked.push(`${fresh.leadId}: ${enrolled.reason}`);
    }
  }

  const due = await tickDueSequenceSteps({ forbidSend });
  result.drafts += due.drafts;
  result.sent += due.sent;
  result.stopped += due.stopped;
  result.blocked.push(...due.blocked);

  if (!forbidSend) {
    const polled = await pollGmailReplies();
    result.replies += polled.replies;
    result.stopped += polled.stopped;
    result.escalated += polled.escalated;
  }

  return result;
}

export async function tickDueSequenceSteps(input: { forbidSend?: boolean } = {}) {
  const policy = await getOutreachEnginePolicy();
  const out = { drafts: 0, sent: 0, stopped: 0, blocked: [] as string[] };
  if (!policy.enabled) return out;

  const due = await prisma.outreachSequenceStep.findMany({
    where: {
      status: "PENDING",
      dueAt: { lte: new Date() },
      sequence: { status: "ACTIVE" },
    },
    include: {
      sequence: { include: { lead: { include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } } } } },
    },
    take: 20,
    orderBy: { dueAt: "asc" },
  });

  for (const step of due) {
    const previous = await prisma.outreachSequenceStep.findFirst({
      where: { sequenceId: step.sequenceId, stepIndex: step.stepIndex - 1 },
    });
    if (step.stepIndex > 0 && previous?.status !== "SENT") {
      continue;
    }
    const lead = step.sequence.lead;
    const suppression = await readSuppressionState({
      email: lead.email,
      websiteHost: lead.websiteHost,
      phone: lead.phone,
    });
    const eligibility = canEnterOutreach({
      verdict: lead.audits[0]?.verdict,
      auditedAt: lead.audits[0]?.createdAt,
      suppressed: lead.suppressed || suppression === "suppressed",
      unsubscribed: suppression === "suppressed",
      suppressionUnknown: suppression === "unknown",
      leadStatus: lead.status,
      sequenceStopReason: step.sequence.stopReason,
      purpose: "follow_up",
    });
    if (
      !eligibility.ok ||
      lead.status === "REPLIED" ||
      lead.status === "INTERESTED" ||
      lead.status === "MEETING" ||
      lead.status === "DO_NOT_CONTACT"
    ) {
      const stopCode = eligibility.ok ? "REPLY" : eligibility.code;
      await stopSequence(step.sequenceId, stopCode, {
        leadStatus:
          lead.status === "REPLIED" ||
          lead.status === "INTERESTED" ||
          lead.status === "MEETING" ||
          lead.status === "DO_NOT_CONTACT"
            ? lead.status
            : undefined,
      });
      await writeAudit({
        action: "outreach.followup.blocked",
        entity: "outreach_sequence_step",
        entityId: step.id,
        payload: { code: stopCode, reason: eligibility.reason, leadId: lead.id },
      });
      out.stopped += 1;
      continue;
    }
    const claimed = await claimDueSequenceStep(step.id);
    if (!claimed) continue;

    const prompt = await prisma.prompt.findUnique({ where: { agentSlug: "outreach_writer" } });
    const result = await getAgent("outreach_writer").execute({
      lead,
      prompt: prompt?.content ?? "",
      payload: { channel: step.sequence.channel, stepKind: step.kind as SequenceStepKind },
    });
    const draftId =
      result.ok && result.output && typeof result.output === "object" && "draftId" in result.output
        ? String((result.output as { draftId?: string }).draftId ?? "")
        : "";
    if (!draftId) {
      await prisma.outreachSequenceStep.update({
        where: { id: step.id },
        data: { status: "PENDING", skipReason: "Decision Maker gate or writer skipped this step." },
      });
      await writeAudit({
        action: "outreach.followup.blocked",
        entity: "outreach_sequence_step",
        entityId: step.id,
        payload: { code: "NO_DRAFT", leadId: lead.id, kind: step.kind },
      });
      out.blocked.push(`${lead.leadId} step ${step.kind}: no draft`);
      continue;
    }
    await prisma.outreachSequenceStep.update({
      where: { id: step.id },
      data: { status: "AWAITING_APPROVAL", draftId },
    });
    await prisma.outreachDraft.update({
      where: { id: draftId },
      data: { stepKind: step.kind },
    });
    await writeAudit({
      action: "outreach.followup.scheduled",
      entity: "outreach_sequence_step",
      entityId: step.id,
      payload: { draftId, kind: step.kind, leadId: lead.id },
    });
    out.drafts += 1;

    if (policy.sendMode === "auto" && !policy.sendsPaused && !input.forbidSend) {
      await prisma.outreachDraft.update({
        where: { id: draftId },
        data: { status: "APPROVED", approvedAt: new Date(), approvedBy: "auto" },
      });
      const send = await sendApprovedDraft(draftId, {
        explicitApproval: true,
        command: input.forbidSend ? "do not send" : "auto",
      });
      if (send.ok && send.sent) out.sent += 1;
      else if (!send.ok) out.blocked.push(`${lead.leadId}: ${send.message}`);
    }
  }

  return out;
}

export async function ingestReply(input: {
  leadId: string;
  text: string;
  channel?: "EMAIL" | "LINKEDIN" | "INSTAGRAM" | "FACEBOOK" | "X_TWITTER";
  intent?: ReplyIntent;
}) {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new Error("Lead not found.");
  const policy = await getOutreachEnginePolicy();
  const classified = input.intent ? classifyIntent(input.intent, input.text) : classifyReply(input.text);

  const reply = await prisma.outreachReply.create({
    data: {
      leadId: lead.id,
      channel: input.channel ?? "EMAIL",
      intent: classified.intent,
      rawText: input.text,
      summary: classified.summary,
      escalated: classified.escalate,
    },
  });
  await prisma.outreachEvent.create({
    data: {
      leadId: lead.id,
      type: "REPLY",
      channel: input.channel ?? "EMAIL",
      payload: { intent: classified.intent, replyId: reply.id },
    },
  });

  const stopped = await stopSequencesForLead(lead.id, classified.intent);
  const connection = await prisma.linkedInConnection.findUnique({ where: { leadId: lead.id } });
  const connected = connection?.status === "CONNECTED";
  const analysis = (await import("@/lib/conversation/analyze")).analyzeConversationReply(input.text);
  const stopLinkedIn = (await import("@/lib/conversation/analyze")).shouldStopLinkedInOnReply(analysis.cue);
  if (stopLinkedIn) {
    const { stopLinkedInConnectionLifecycle } = await import("@/lib/linkedin/connection/lifecycle");
    await stopLinkedInConnectionLifecycle(
      lead.id,
      analysis.cue === "dnc" ? "unsubscribe" : `reply:${classified.intent}`,
    );
  }
  if (classified.suppress) {
    if (lead.email) {
      await prisma.suppression.upsert({
        where: { email: lead.email.toLowerCase() },
        update: { reason: input.channel === "X_TWITTER" ? "twitter_no" : "unsubscribe" },
        create: {
          email: lead.email.toLowerCase(),
          reason: input.channel === "X_TWITTER" ? "twitter_no" : "unsubscribe",
        },
      });
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { suppressed: true, status: "DO_NOT_CONTACT", lastActivityAt: new Date() },
    });
    await writeAudit({
      action: input.channel === "X_TWITTER" ? "outreach.twitter.declined" : "outreach.unsubscribe",
      entity: "lead",
      entityId: lead.id,
      payload: { email: lead.email?.toLowerCase() ?? null, replyId: reply.id, channel: input.channel ?? "EMAIL" },
    });
    await writeAudit({
      action: "lead.do_not_contact",
      entity: "lead",
      entityId: lead.id,
      payload: { reason: classified.intent === "NOT_INTERESTED" ? "said_no" : "unsubscribe", channel: input.channel ?? "EMAIL" },
    });
  } else if (classified.leadStatus) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: classified.leadStatus, lastActivityAt: new Date() },
    });
  }

  let draftId: string | null = null;
  let conversation = null as Awaited<ReturnType<(typeof import("@/lib/conversation/persist"))["applyConversationReply"]>> | null;
  const useConversation = input.channel === "LINKEDIN";
  if (useConversation) {
    const research = await prisma.linkedInResearch.findFirst({
      where: { leadId: lead.id, status: "AVAILABLE" },
      orderBy: { retrievedAt: "desc" },
    });
    const { applyConversationReply, contextFromLead } = await import("@/lib/conversation/persist");
    conversation = await applyConversationReply({
      leadId: lead.id,
      text: input.text,
      channel: "LINKEDIN",
      connected,
      ctx: contextFromLead({
        name: lead.name,
        company: lead.company,
        headline: research?.headline,
        about: research?.about,
        roleTitle: research?.roleTitle,
      }),
    });
    draftId = conversation.draftId;
    if (conversation.stopLinkedIn && !stopLinkedIn) {
      const { stopLinkedInConnectionLifecycle } = await import("@/lib/linkedin/connection/lifecycle");
      await stopLinkedInConnectionLifecycle(lead.id, conversation.decision.to);
    }
    await prisma.outreachReply.update({
      where: { id: reply.id },
      data: { draftId, summary: conversation.analysis.summary },
    });
  } else {
    const suggestion = suggestedReply({
      intent: classified.intent,
      name: lead.name,
      bookingUrl: policy.bookingUrl?.trim() || `${(process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "")}/go/website`,
      channel: input.channel ?? "EMAIL",
      contactEmail: process.env.OUTREACH_FROM_EMAIL || "you@example.com",
    });
    if (suggestion.message && classified.intent !== "UNSUBSCRIBE" && classified.intent !== "NOT_INTERESTED") {
      const created = await prisma.outreachDraft.create({
        data: {
          leadId: lead.id,
          channel: input.channel ?? "EMAIL",
          subject: suggestion.subject || null,
          message: suggestion.message,
          status: "PENDING_APPROVAL",
          reasonForContacting: `Reply classified as ${classified.intent}. Sequence stopped.`,
          firstMessageGoal: "Respond to their reply. Do not continue the cadence.",
          stepKind: "REPLY",
          mode: "heuristic",
        },
      });
      draftId = created.id;
      await prisma.outreachReply.update({ where: { id: reply.id }, data: { draftId } });
    }
  }

  await writeAudit({
    action: classified.intent === "WANTS_MEETING" ? "outreach.meeting" : "outreach.reply",
    entity: "lead",
    entityId: lead.id,
    payload: { intent: classified.intent, stopped, escalated: classified.escalate, draftId },
  });
  const { recordLeadOutcome } = await import("@/lib/intelligence/outcome");
  await recordLeadOutcome({
    leadId: lead.id,
    channel: input.channel ?? "EMAIL",
    draftId,
    patch: {
      replied: true,
      noResponse: false,
      sequenceStopped: classified.stopSequence,
      interested: classified.intent === "INTERESTED",
      meeting: classified.intent === "WANTS_MEETING",
      pricing: classified.intent === "NEEDS_PRICING",
      notInterested: classified.intent === "NOT_INTERESTED",
      wrongPerson: classified.intent === "WRONG_PERSON",
      unsubscribe: classified.intent === "UNSUBSCRIBE",
      replyIntent: classified.intent,
    },
  });

  return {
    ok: true,
    intent: classified.intent,
    stopped,
    escalated: classified.escalate,
    draftId,
    summary: conversation?.analysis.summary ?? classified.summary,
    conversationStage: conversation?.decision.to ?? null,
    pitchAllowed: conversation?.decision.pitchAllowed ?? false,
  };
}

export async function pollGmailReplies() {
  const out = { replies: 0, stopped: 0, escalated: 0 };
  const connection = await prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!connection?.scopes.some((scope) => scope.includes("gmail.readonly") || scope.includes("gmail.modify"))) {
    return out;
  }
  let gmail;
  try {
    const { client } = await getGoogleClient();
    gmail = google.gmail({ version: "v1", auth: client });
  } catch {
    return out;
  }
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const sent = await prisma.outreachEvent.findMany({
    where: { type: "SENT", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const self = (connection.googleEmail ?? "").toLowerCase();
  for (const event of sent) {
    const threadId =
      event.payload && typeof event.payload === "object" && "threadId" in event.payload
        ? String((event.payload as { threadId?: string }).threadId ?? "")
        : "";
    if (!threadId) continue;
    const existing = await prisma.outreachReply.findFirst({
      where: { leadId: event.leadId, createdAt: { gte: event.createdAt } },
    });
    if (existing) continue;
    try {
      const thread = await gmail.users.threads.get({ userId: "me", id: threadId, format: "metadata" });
      const messages = thread.data.messages ?? [];
      if (messages.length < 2) continue;
      const last = messages[messages.length - 1];
      const from = last.payload?.headers?.find((header) => header.name?.toLowerCase() === "from")?.value ?? "";
      if (self && from.toLowerCase().includes(self)) continue;
      const snippet = (last.snippet ?? "").trim();
      if (!snippet) continue;
      const ingested = await ingestReply({ leadId: event.leadId, text: snippet, channel: "EMAIL" });
      out.replies += 1;
      out.stopped += ingested.stopped;
      if (ingested.escalated) out.escalated += 1;
    } catch {
      continue;
    }
  }
  return out;
}
