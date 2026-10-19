"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { productionLeadWhere } from "@/lib/analytics/production";
import { canPerformExternalAction, canTransitionDraftTo } from "@/lib/intelligence/approval";
import { getAgent } from "@/lib/agents/registry";
import { getOutreachEnginePolicy, saveOutreachEnginePolicy, assumeOutreachControl } from "@/lib/outreach/sequence";
import { sendApprovedDraft } from "@/lib/outreach/send";
import { canEnterOutreach } from "@/lib/outreach/gate";
import { CONVERSATION_REPLY_STEP } from "@/lib/conversation/types";
import { LINKEDIN_CONNECT_STEP, LINKEDIN_POST_CONNECTION_STEP } from "@/lib/linkedin/connection/types";

export async function approveAllPendingDrafts() {
  const drafts = await prisma.outreachDraft.findMany({
    where: {
      status: { in: ["PENDING_APPROVAL", "EDITED"] },
      NOT: { stepKind: "TEST_TRANSPORT" },
      lead: productionLeadWhere(),
    },
    include: { lead: { include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  let approved = 0;
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const draft of drafts) {
    const isReply = draft.stepKind === "REPLY" || draft.stepKind === CONVERSATION_REPLY_STEP;
    const eligible = isReply || draft.lead.audits[0]?.verdict === "PASS";
    if (!eligible) {
      skipped += 1;
      continue;
    }
    try {
      const result = await approveDraft(draft.id);
      if (result.ok) {
        approved += 1;
        if (result.sent) sent += 1;
      } else skipped += 1;
    } catch (error) {
      skipped += 1;
      errors.push(error instanceof Error ? error.message : "Approve failed.");
    }
  }
  await writeAudit({
    action: "draft.approve_all",
    entity: "outreach_draft",
    payload: { approved, sent, skipped, total: drafts.length },
  });
  revalidate();
  return {
    ok: true,
    approved,
    sent,
    skipped,
    total: drafts.length,
    message: `Approved ${approved} of ${drafts.length} (${sent} emailed). ${skipped} skipped.`,
    errors: errors.slice(0, 5),
  };
}

export async function approveDraft(draftId: string) {
  if (!canTransitionDraftTo("PENDING_APPROVAL", "APPROVED", { explicitApproval: true })) {
    throw new Error("APPROVAL_REQUIRED: draft cannot be approved implicitly.");
  }
  const existing = await prisma.outreachDraft.findUnique({
    where: { id: draftId },
    include: { lead: { include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  if (!existing) throw new Error("Draft not found.");
  if (existing.stepKind === "TEST_TRANSPORT") {
    return { ok: false, sendReady: false, sent: false, message: "Use SEND TEST EMAIL on the test-transport path." };
  }
  if (existing.stepKind !== "REPLY" && existing.stepKind !== CONVERSATION_REPLY_STEP) {
    const eligibility = canEnterOutreach({
      verdict: existing.lead.audits[0]?.verdict,
      auditedAt: existing.lead.audits[0]?.createdAt,
      suppressed: existing.lead.suppressed,
      leadStatus: existing.lead.status,
      purpose: "approve",
    });
    if (!eligibility.ok) {
      await writeAudit({
        action: "lead.blocked",
        entity: "outreach_draft",
        entityId: draftId,
        payload: { code: eligibility.code, reason: eligibility.reason, stage: "approve" },
      });
      return { ok: false, sendReady: false, sent: false, message: eligibility.reason };
    }
  }
  const draft = await prisma.outreachDraft.update({
    where: { id: draftId },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: "operator" },
    include: { lead: true },
  });
  if (
    draft.stepKind === LINKEDIN_CONNECT_STEP ||
    draft.stepKind === LINKEDIN_POST_CONNECTION_STEP ||
    draft.stepKind === CONVERSATION_REPLY_STEP ||
    draft.channel === "LINKEDIN" ||
    draft.channel === "INSTAGRAM" ||
    draft.channel === "X_TWITTER"
  ) {
    if (draft.stepKind === LINKEDIN_CONNECT_STEP) {
      const { approveLinkedInConnection } = await import("@/lib/linkedin/connection/lifecycle");
      await approveLinkedInConnection(draft.leadId);
    }
    await prisma.outreachEvent.create({
      data: {
        leadId: draft.leadId,
        draftId,
        type: "APPROVED",
        channel: draft.channel,
        payload: {
          note:
            draft.channel === "X_TWITTER"
              ? "Human approved an X draft. Auto-send uses X Daily Outreach (Jarvis Chrome), not this approve path."
              : "Human approved a LinkedIn lifecycle draft. Jarvis will not send the invite or DM.",
        },
      },
    });
    await writeAudit({ action: "draft.approve", entity: "outreach_draft", entityId: draftId });
    revalidate();
    return {
      ok: true,
      sendReady: false,
      sent: false,
      message:
        draft.channel === "X_TWITTER"
          ? "Approved. Turn ON X Daily Outreach and Send X DMs now for Jarvis Chrome auto-DM."
          : "Approved. Jarvis will not send LinkedIn connection requests or DMs.",
    };
  }
  await prisma.lead.update({
    where: { id: draft.leadId },
    data: { status: "APPROVED", lastActivityAt: new Date() },
  });
  await prisma.outreachEvent.create({
    data: {
      leadId: draft.leadId,
      draftId,
      type: "APPROVED",
      channel: draft.channel,
      payload: { note: "Human approved. Send still follows kill switch, send mode, and caps." },
    },
  });
  await writeAudit({ action: "draft.approve", entity: "outreach_draft", entityId: draftId });
  const policy = await getOutreachEnginePolicy();
  if (policy.sendMode === "send_on_approve" || policy.sendMode === "auto") {
    const sent = await sendApprovedDraft(draftId, { explicitApproval: true });
    revalidate();
    return {
      ok: true,
      sendReady: sent.ok,
      sent: sent.sent,
      message: sent.ok ? sent.message : `Approved. ${sent.message}`,
    };
  }
  revalidate();
  return {
    ok: true,
    sendReady: canPerformExternalAction(draft.status) && false,
    message: "Approved. Kill switch / draft-only mode is on — Jarvis queued the sequence but did not send.",
  };
}

export async function regenerateDraft(draftId: string) {
  const existing = await prisma.outreachDraft.findUnique({
    where: { id: draftId },
    include: { lead: true },
  });
  if (!existing) throw new Error("Draft not found.");
  if (existing.lead.suppressed || existing.lead.status === "DO_NOT_CONTACT") {
    throw new Error("Draft regeneration blocked: lead is suppressed or do-not-contact.");
  }
  const audit = await prisma.leadAudit.findFirst({
    where: { leadId: existing.leadId },
    orderBy: { createdAt: "desc" },
  });
  const eligibility = canEnterOutreach({
    verdict: audit?.verdict,
    auditedAt: audit?.createdAt,
    suppressed: existing.lead.suppressed,
    leadStatus: existing.lead.status,
    purpose: "draft",
  });
  if (!eligibility.ok) {
    throw new Error(eligibility.reason);
  }
  const prompt = await prisma.prompt.findUnique({ where: { agentSlug: "outreach_writer" } });
  const result = await getAgent("outreach_writer").execute({
    lead: existing.lead,
    prompt: prompt?.content ?? "",
    payload: { channel: existing.channel },
  });
  if (!result.ok) throw new Error(result.error || "Draft regeneration failed.");
  await writeAudit({ action: "draft.regenerate", entity: "outreach_draft", entityId: draftId });
  revalidate();
  return { ok: true, message: "Regenerated as a new draft awaiting approval. Nothing was sent." };
}

export async function rejectDraft(draftId: string, reason: string) {
  const draft = await prisma.outreachDraft.update({
    where: { id: draftId },
    data: { status: "REJECTED", rejectionReason: reason || "Rejected by operator" },
  });
  await prisma.outreachEvent.create({
    data: {
      leadId: draft.leadId,
      draftId,
      type: "REJECTED",
      channel: draft.channel,
      payload: { reason },
    },
  });
  if (draft.stepKind === LINKEDIN_CONNECT_STEP || draft.stepKind === LINKEDIN_POST_CONNECTION_STEP) {
    const { rejectLinkedInRecommendationDraft } = await import("@/lib/linkedin/connection/lifecycle");
    await rejectLinkedInRecommendationDraft(draft);
  }
  await writeAudit({ action: "draft.reject", entity: "outreach_draft", entityId: draftId, payload: { reason } });
  revalidate();
}

export async function editDraft(draftId: string, message: string, subject?: string) {
  const draft = await prisma.outreachDraft.update({
    where: { id: draftId },
    data: {
      message,
      subject: subject || undefined,
      status: "EDITED",
      editedAt: new Date(),
    },
  });
  await prisma.outreachEvent.create({
    data: {
      leadId: draft.leadId,
      draftId,
      type: "EDITED",
      channel: draft.channel,
    },
  });
  revalidate();
}

export async function markContacted(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: "CONTACTED", lastActivityAt: new Date() },
  });
  await prisma.outreachEvent.create({
    data: { leadId, type: "CONTACTED_MANUAL", payload: { note: "Operator recorded an external send." } },
  });
  revalidate();
}

export async function saveOutreachEngineAction(formData: FormData) {
  const current = await getOutreachEnginePolicy();
  const sendMode = String(formData.get("sendMode") || current.sendMode);
  await saveOutreachEnginePolicy({
    ...current,
    enabled: formData.get("enabled") === "on",
    sendsPaused: formData.get("sendsPaused") === "on",
    sendMode: sendMode === "send_on_approve" || sendMode === "auto" ? sendMode : "draft_only",
    dailySendLimit: Number(formData.get("dailySendLimit") || current.dailySendLimit),
    maxActiveSequences: Number(formData.get("maxActiveSequences") || current.maxActiveSequences),
    bookingUrl: String(formData.get("bookingUrl") || ""),
    emailEnabled: formData.get("emailEnabled") === "on",
    linkedinDrafts: formData.get("linkedinDrafts") === "on",
    instagramDrafts: formData.get("instagramDrafts") === "on",
    twitterDrafts: formData.get("twitterDrafts") === "on",
    twitterDmDailyCap: Number(formData.get("twitterDmDailyCap") || current.twitterDmDailyCap),
    linkedinConnectionDailyCap: Number(formData.get("linkedinConnectionDailyCap") || current.linkedinConnectionDailyCap),
    linkedinMessageDailyCap: Number(formData.get("linkedinMessageDailyCap") || current.linkedinMessageDailyCap),
  });
  revalidate();
}

export async function setLinkedInDailyOutreachAction(formData: FormData) {
  const enabled = String(formData.get("linkedinDailyOutreach") || "") === "on";
  if (enabled) {
    // assumeOutreachControl turns kill switch off and Daily channels on (policy only).
    await assumeOutreachControl();
  } else {
    const current = await getOutreachEnginePolicy();
    await saveOutreachEnginePolicy({
      ...current,
      linkedinDailyOutreach: false,
    });
  }
  // Policy only — live send is Home → runHomeChannelAction.
  revalidate();
  return { enabled, worker: null };
}

export async function setTwitterDailyOutreachAction(formData: FormData) {
  const enabled = String(formData.get("twitterDailyOutreach") || "") === "on";
  if (enabled) {
    await assumeOutreachControl();
  } else {
    const current = await getOutreachEnginePolicy();
    await saveOutreachEnginePolicy({
      ...current,
      twitterDailyOutreach: false,
    });
  }
  // Policy only — live send is Home → runHomeChannelAction.
  revalidate();
  return { enabled, worker: null };
}

export async function runLinkedInDailyOutreachFormAction(mode: "connections" | "messages" | "both" = "both") {
  await assumeOutreachControl();
  const { runLinkedInDailyOutreachWorker } = await import("@/lib/linkedin/daily/worker");
  const result = await runLinkedInDailyOutreachWorker(new Date(), mode);
  revalidate();
  return result;
}

export async function runTwitterDailyOutreachFormAction() {
  const { runTwitterDailyOutreachWorker } = await import("@/lib/twitter/daily/worker");
  const result = await runTwitterDailyOutreachWorker();
  revalidate();
  return result;
}

export async function fillLinkedInDailyQueueAction() {
  const { fillLinkedInDailyQueue } = await import("@/lib/linkedin/connection/queue");
  const result = await fillLinkedInDailyQueue();
  revalidate();
  return result;
}

export async function runOutreachEngineAction(input: { allowSend?: boolean; limit?: number } = {}) {
  const { runOutreachEngine } = await import("@/lib/outreach/engine");
  const { HARD_DAILY_SEND_LIMIT } = await import("@/lib/outreach/policy");
  const allowSend = input.allowSend === true;
  const limit = Math.min(
    HARD_DAILY_SEND_LIMIT,
    Math.max(1, input.limit ?? (allowSend ? HARD_DAILY_SEND_LIMIT : 10)),
  );
  const result = await runOutreachEngine({
    limit,
    command: allowSend
      ? "Run outreach engine. Send PASS email when commercial gates clear."
      : "Run outreach engine. Do not send.",
  });
  revalidate();
  return result;
}

export async function runLiveOutreachAction(input: { reuseSheet?: boolean } = {}) {
  const { runLiveOutreach } = await import("@/lib/outreach/run-live");
  const report = await runLiveOutreach({ importSheet: true, reuseSheet: input.reuseSheet });
  await approveAllPendingDrafts();
  revalidate();
  revalidatePath("/");
  revalidatePath("/integrations/linkedin");
  return report;
}

export async function runLiveOutreachFormAction(): Promise<void> {
  await runLiveOutreachAction();
}

export async function ingestReplyAction(formData: FormData) {
  const leadId = String(formData.get("leadId") || "");
  const text = String(formData.get("text") || "");
  if (!leadId || !text.trim()) throw new Error("Reply text is required.");
  const { ingestReply } = await import("@/lib/outreach/engine");
  const channelRaw = String(formData.get("channel") || "EMAIL");
  const channel =
    channelRaw === "LINKEDIN" || channelRaw === "INSTAGRAM" || channelRaw === "FACEBOOK" || channelRaw === "X_TWITTER"
      ? channelRaw
      : "EMAIL";
  const result = await ingestReply({ leadId, text, channel });
  revalidate();
  revalidatePath(`/leads/${leadId}`);
  return result;
}

export async function fillLinkedInDailyQueueFormAction(): Promise<void> {
  await fillLinkedInDailyQueueAction();
}

export async function runOutreachEngineFormAction(): Promise<void> {
  await runOutreachEngineAction();
}

export async function ingestReplyFormAction(formData: FormData): Promise<void> {
  await ingestReplyAction(formData);
}

export async function runHomeChannelAction(
  channel: "linkedin" | "linkedin-connect" | "linkedin-message" | "twitter" | "email",
) {
  type EmailStats = {
    waveSent: number;
    waveDrafted: number;
    waveSkipped: number;
    waveFiltered: number;
    waveReplied: number;
    repliedTotal: number;
    emailsSentToday: number;
    dailyCap: number;
    remainingToday: number;
    waveLimit: number;
  };
  const { getBrowserAgentProvider } = await import("@/lib/browser-agent/provider");
  const { noteChromeNavigation } = await import("@/lib/tools/chrome");
  try {
    await getBrowserAgentProvider().connect();
  } catch (error) {
    return {
      ok: false as const,
      lines: [error instanceof Error ? error.message : "Jarvis Chrome did not open."],
      email: null as EmailStats | null,
      social: null,
    };
  }

  if (channel === "linkedin" || channel === "linkedin-connect" || channel === "linkedin-message") {
    const mode =
      channel === "linkedin-connect" ? "connections" : channel === "linkedin-message" ? "messages" : "both";
    const { openLinkedInFeed } = await import("@/lib/linkedin/session/open");
    const opened = await openLinkedInFeed();
    noteChromeNavigation(opened.url, opened.ok ? null : opened.message);
    if (!opened.ok || !opened.signedIn) {
      return {
        ok: false as const,
        lines: [opened.message, "Sign into LinkedIn in the Jarvis Chrome window, then click again."],
        email: null as EmailStats | null,
        social: null,
      };
    }
    await assumeOutreachControl();
    const worker = await (await import("@/lib/linkedin/daily/worker")).runLinkedInDailyOutreachWorker(
      new Date(),
      mode,
    );
    revalidate();
    const waveConn = worker.waveConnections ?? 0;
    const waveMsg = worker.waveMessages ?? 0;
    const skipHint = worker.skipMix?.length ? ` Skips: ${worker.skipMix.join(", ")}.` : "";
    const refreshHint =
      worker.auditsRefreshed && worker.auditsRefreshed > 0
        ? ` Refreshed ${worker.auditsRefreshed} stale PASS audit(s).`
        : "";
    const alreadyInvited =
      mode === "connections" && (worker.skipMix ?? []).some((s) => String(s).startsWith("ALREADY_INVITED"));
    const waveLine =
      mode === "connections"
        ? `This wave: ${waveConn} new connection request(s) (target ≤10).`
        : mode === "messages"
          ? `This wave: ${waveMsg} message(s) to CONNECTED people (target ≤10).`
          : `This wave: ${waveConn} connection(s) · ${waveMsg} message(s) (target ≤10 each).`;
    return {
      ok: true as const,
      lines: [
        opened.message,
        waveLine,
        `Today totals: connections ${worker.connectionsSent ?? 0} · messages ${worker.messagesSent ?? 0}.`,
        `Qualified this run: ${worker.qualifiedConnections ?? 0} connects · ${worker.qualifiedMessages ?? 0} messages.${refreshHint}${skipHint}`,
        alreadyInvited && waveConn === 0
          ? "ALREADY_INVITED = LinkedIn already shows Pending on that profile (invite was out before). Not a new send. Marked REQUESTED so the next Connect wave skips them."
          : "",
      ].filter(Boolean),
      email: null as null,
      social: {
        channel: "linkedin" as const,
        connections: waveConn,
        messages: waveMsg,
        connectionsToday: worker.connectionsSent ?? 0,
        messagesToday: worker.messagesSent ?? 0,
      },
    };
  }

  if (channel === "twitter") {
    const { openTwitterHome } = await import("@/lib/twitter/session/open");
    const opened = await openTwitterHome();
    noteChromeNavigation(opened.url, opened.ok ? null : opened.message);
    if (!opened.ok || !opened.signedIn) {
      return {
        ok: false as const,
        lines: [opened.message, "Sign into x.com in the Jarvis Chrome window, then click Open X again."],
        email: null as null,
        social: null,
      };
    }
    await assumeOutreachControl();
    const { HOME_TWITTER_DM_WAVE_LIMIT } = await import("@/lib/twitter/daily/events");
    const worker = await (await import("@/lib/twitter/daily/worker")).runTwitterDailyOutreachWorker(new Date(), {
      waveLimit: HOME_TWITTER_DM_WAVE_LIMIT,
    });
    revalidate();
    const waveDms = worker.waveDms ?? worker.sent?.length ?? 0;
    const follows = worker.followsThisWave ?? 0;
    const skipHint = worker.skipMix?.length ? ` Skips: ${worker.skipMix.join(", ")}.` : "";
    return {
      ok: true as const,
      lines: [
        opened.message,
        `This wave: ${follows} follow(s) · ${waveDms} DM(s) (target ≤10 each).`,
        `Today: follows ${worker.followsToday ?? 0} · DMs ${worker.dmsSent ?? 0} / ${worker.dmCap ?? 10}.`,
        `PASS candidates tried: ${worker.candidates ?? 0}.${skipHint}`,
        waveDms === 0 && follows === 0
          ? "No X activity — need PASS leads with person twitter URLs that were not already DM'd, and Chat composer unlocked."
          : "",
      ].filter(Boolean),
      email: null as null,
      social: {
        channel: "twitter" as const,
        follows,
        dms: waveDms,
        followsToday: worker.followsToday ?? 0,
        dmsToday: worker.dmsSent ?? 0,
      },
    };
  }

  const { openGmailInbox } = await import("@/lib/outreach/open-gmail");
  const opened = await openGmailInbox();
  if (!opened.ok || !opened.signedIn) {
    return {
      ok: false as const,
      lines: [opened.message, "Sign into Gmail in the Jarvis Chrome window, then click Open Gmail again."],
      email: null as EmailStats | null,
      social: null,
    };
  }
  await assumeOutreachControl();
  const { HOME_EMAIL_WAVE_LIMIT } = await import("@/lib/outreach/home-email-pulse");
  const { runEmailSendNowWorker } = await import("@/lib/outreach/email-send-now");
  const wave = await runEmailSendNowWorker({ limit: HOME_EMAIL_WAVE_LIMIT });
  const { getHomeEmailPulse } = await import("@/lib/outreach/home-email-pulse");
  const pulse = await getHomeEmailPulse();
  revalidate();
  const reconnect = wave.reason === "GMAIL_RECONNECT_REQUIRED";
  const email: EmailStats = {
    waveSent: wave.sent,
    waveDrafted: wave.drafted,
    waveSkipped: wave.skipped,
    waveFiltered: wave.filtered,
    waveReplied: wave.replied,
    repliedTotal: pulse.repliedTotal,
    emailsSentToday: pulse.emailsSentToday,
    dailyCap: pulse.dailyCap,
    remainingToday: pulse.remainingToday,
    waveLimit: HOME_EMAIL_WAVE_LIMIT,
  };
  const ok = Boolean((wave.ok || wave.sent > 0) && !reconnect);
  return {
    ok,
    lines: [
      reconnect
        ? "Google login expired — reconnect before more sends."
        : wave.sent > 0
          ? `This wave: filtered ${wave.filtered} · sent ${wave.sent} of up to ${HOME_EMAIL_WAVE_LIMIT}.`
          : wave.reason,
      `Report: filtered ${wave.filtered} · sent ${wave.sent} · replied (wave) ${wave.replied} · replied total ${pulse.repliedTotal}.`,
      `Today: ${pulse.emailsSentToday} / ${pulse.dailyCap} emails · ${pulse.remainingToday} left.`,
      wave.sent === 0 && wave.drafted
        ? `Prepared ${wave.drafted} but Gmail did not accept them — nothing left as a draft queue on purpose.`
        : `Marked done: ${wave.sent} lead(s) CONTACTED (will not reuse). Skipped ${wave.skipped}.`,
      ...(reconnect
        ? ["Reconnect Google: http://localhost:3000/api/google/oauth?gmail=1"]
        : wave.sent === 0
          ? wave.blockers.slice(0, 3)
          : []),
    ],
    email,
    social: null,
  };
}

function revalidate() {
  revalidatePath("/outreach");
  revalidatePath("/leads");
  revalidatePath("/");
  revalidatePath("/jarvis");
}
