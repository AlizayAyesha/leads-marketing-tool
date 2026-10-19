import "server-only";

import { socialAutomationEnabled } from "@/lib/features";

import type { OutreachChannel } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting, writeAudit } from "@/lib/db/settings";
import {
  DEFAULT_OUTREACH_ENGINE,
  OUTREACH_ENGINE_KEY,
  mergeOutreachEnginePolicy,
  sequencePlan,
  type OutreachEnginePolicy,
} from "@/lib/outreach/policy";
import { canEnrollInSequence, SEQUENCE_REPLY_STOP_REASONS } from "@/lib/outreach/gate";
import type { AuditVerdict } from "@/lib/intelligence/audit";

export async function getOutreachEnginePolicy() {
  const raw = await getSetting<unknown>(OUTREACH_ENGINE_KEY, DEFAULT_OUTREACH_ENGINE);
  return mergeOutreachEnginePolicy(raw);
}

export async function saveOutreachEnginePolicy(policy: OutreachEnginePolicy) {
  const next = mergeOutreachEnginePolicy(policy);
  await setSetting(OUTREACH_ENGINE_KEY, next);
  await writeAudit({ action: "outreach.engine.save", entity: "setting", payload: { sendsPaused: next.sendsPaused, sendMode: next.sendMode } });
  return next;
}

/**
 * Operator clicked outreach controls: channels on. The kill switch (sendsPaused) is NEVER
 * turned off here — it can only be turned off explicitly in Outreach → Engine.
 * LinkedIn/X daily outreach is only enabled when ENABLE_SOCIAL_AUTOMATION=true.
 */
export async function assumeOutreachControl() {
  const current = await getOutreachEnginePolicy();
  return saveOutreachEnginePolicy({
    ...current,
    enabled: true,
    sendsPaused: current.sendsPaused,
    sendMode: current.sendsPaused ? current.sendMode : "auto",
    emailEnabled: true,
    linkedinDrafts: true,
    twitterDrafts: true,
    linkedinDailyOutreach: socialAutomationEnabled(),
    twitterDailyOutreach: socialAutomationEnabled(),
    // Floor daily ceilings so home clicks can reach ~10 each when candidates exist.
    linkedinConnectionDailyCap: Math.max(10, current.linkedinConnectionDailyCap || 0),
    linkedinMessageDailyCap: Math.max(10, current.linkedinMessageDailyCap || 0),
    twitterDmDailyCap: Math.max(10, current.twitterDmDailyCap || 0),
  });
}

export async function countSentToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.outreachEvent.count({
    where: { type: "SENT", createdAt: { gte: start } },
  });
}

/** Email-only sends today (home dashboard tracker). */
export async function countEmailsSentToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.outreachEvent.count({
    where: { type: "SENT", channel: "EMAIL", createdAt: { gte: start } },
  });
}

export async function countActiveSequences() {
  return prisma.outreachSequence.count({ where: { status: "ACTIVE" } });
}

export async function enrollSequence(input: {
  leadId: string;
  channel: OutreachChannel;
  auditVerdict: AuditVerdict | null;
  auditedAt?: Date | string | null;
  leadStatus: string;
  suppressed: boolean;
  unsubscribed: boolean;
  suppressionUnknown?: boolean;
  draftId?: string | null;
}) {
  const policy = await getOutreachEnginePolicy();
  const testRecipientConfirmed = await import("@/lib/outreach/test-recipient").then((mod) =>
    mod.isConfirmedTestRecipient(input.leadId),
  );
  const [sentToday, activeSequences, existing] = await Promise.all([
    countSentToday(),
    countActiveSequences(),
    prisma.outreachSequence.findUnique({
      where: { leadId_channel: { leadId: input.leadId, channel: input.channel } },
    }),
  ]);
  if (existing?.status === "STOPPED" && existing.stopReason && SEQUENCE_REPLY_STOP_REASONS.has(existing.stopReason)) {
    await writeAudit({
      action: "lead.blocked",
      entity: "outreach_sequence",
      entityId: existing.id,
      payload: { code: "SEQUENCE_STOPPED", reason: existing.stopReason, leadId: input.leadId },
    });
    return {
      ok: false as const,
      code: "SEQUENCE_STOPPED",
      reason: "A prior reply already stopped this cadence. Do not re-enroll.",
      sequenceId: existing.id,
    };
  }
  if (existing && existing.status !== "ACTIVE") {
    return {
      ok: false as const,
      code: existing.status === "COMPLETED" ? "SEQUENCE_COMPLETED" : "SEQUENCE_STOPPED",
      reason: "An existing sequence on this channel is stopped or completed. Do not silently re-enroll.",
      sequenceId: existing.id,
    };
  }
  const gate = canEnrollInSequence({
    policy,
    sentToday,
    activeSequences,
    auditVerdict: input.auditVerdict,
    auditedAt: input.auditedAt,
    leadStatus: input.leadStatus,
    suppressed: input.suppressed,
    unsubscribed: input.unsubscribed,
    suppressionUnknown: input.suppressionUnknown,
    sequenceStopReason: existing?.stopReason,
    channel: input.channel,
    gmailSendConnected: false,
    alreadyContactedSameChannel: Boolean(existing && existing.status === "ACTIVE"),
    testRecipientConfirmed,
  });
  if (!gate.ok) {
    await writeAudit({
      action: gate.code === "SEQUENCE_CAP" ? "outreach.sequence.blocked" : "lead.blocked",
      entity: "lead",
      entityId: input.leadId,
      payload: { code: gate.code, reason: gate.reason, channel: input.channel },
    });
    return { ...gate, ok: false as const, sequenceId: existing?.id ?? null };
  }

  if (existing?.status === "ACTIVE") {
    return { ok: false as const, code: "DUPLICATE_SEQUENCE", reason: gate.reason, sequenceId: existing.id };
  }

  const plan = sequencePlan(new Date(), policy.sequenceDays);
  const sequence = await prisma.outreachSequence.create({
    data: {
      leadId: input.leadId,
      channel: input.channel,
      status: "ACTIVE",
      currentStep: 0,
      nextRunAt: plan[0]?.dueAt ?? new Date(),
      steps: {
        create: plan.map((step) => ({
          stepIndex: step.stepIndex,
          kind: step.kind,
          dueAt: step.dueAt,
          status: step.stepIndex === 0 && input.draftId ? "AWAITING_APPROVAL" : "PENDING",
          draftId: step.stepIndex === 0 ? input.draftId ?? null : null,
        })),
      },
    },
  });
  await writeAudit({
    action: "outreach.sequence.enroll",
    entity: "outreach_sequence",
    entityId: sequence.id,
    payload: { leadId: input.leadId, channel: input.channel, steps: plan.map((step) => step.kind) },
  });
  await writeAudit({
    action: "outreach.followup.scheduled",
    entity: "outreach_sequence",
    entityId: sequence.id,
    payload: { days: policy.sequenceDays, channel: input.channel },
  });
  return { ok: true as const, code: "OK", reason: gate.reason, sequenceId: sequence.id };
}

export async function claimDueSequenceStep(stepId: string) {
  const claimed = await prisma.outreachSequenceStep.updateMany({
    where: { id: stepId, status: "PENDING" },
    data: { status: "DRAFTED" },
  });
  return claimed.count === 1;
}

export async function stopSequence(
  sequenceId: string,
  reason: string,
  extra?: { leadStatus?: "REPLIED" | "INTERESTED" | "MEETING" | "LOST" | "DO_NOT_CONTACT" },
) {
  const sequence = await prisma.outreachSequence.update({
    where: { id: sequenceId },
    data: { status: "STOPPED", stopReason: reason, stoppedAt: new Date(), nextRunAt: null },
  });
  await prisma.outreachSequenceStep.updateMany({
    where: { sequenceId, status: { in: ["PENDING", "DRAFTED", "AWAITING_APPROVAL"] } },
    data: { status: "STOPPED", skipReason: reason },
  });
  if (extra?.leadStatus) {
    await prisma.lead.update({
      where: { id: sequence.leadId },
      data: { status: extra.leadStatus, lastActivityAt: new Date() },
    });
  }
  await writeAudit({
    action: "outreach.sequence.stop",
    entity: "outreach_sequence",
    entityId: sequenceId,
    payload: { reason },
  });
  return sequence;
}

export async function stopSequencesForLead(leadId: string, reason: string) {
  const rows = await prisma.outreachSequence.findMany({
    where: { leadId, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  for (const row of rows) await stopSequence(row.id, reason);
  return rows.length;
}

export async function markStepSent(stepId: string) {
  const step = await prisma.outreachSequenceStep.update({
    where: { id: stepId },
    data: { status: "SENT", sentAt: new Date() },
    include: { sequence: true },
  });
  const next = await prisma.outreachSequenceStep.findFirst({
    where: { sequenceId: step.sequenceId, stepIndex: { gt: step.stepIndex } },
    orderBy: { stepIndex: "asc" },
  });
  await prisma.outreachSequence.update({
    where: { id: step.sequenceId },
    data: {
      currentStep: step.stepIndex,
      lastSentAt: new Date(),
      nextRunAt: next?.dueAt ?? null,
      status: next ? "ACTIVE" : "COMPLETED",
    },
  });
  return step;
}
