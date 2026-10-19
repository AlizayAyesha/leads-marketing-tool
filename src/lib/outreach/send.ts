import "server-only";

import { google } from "googleapis";

import { prisma } from "@/lib/db/prisma";
import { getGoogleClient } from "@/lib/data-sources/google";
import { readSuppressionState, writeAudit } from "@/lib/db/settings";
import { assertExternalActionAllowed } from "@/lib/intelligence/approval";
import { canSendMessage } from "@/lib/outreach/gate";
import { auditLooksLikeQuotaPass } from "@/lib/outreach/quality";
import { qualifyCommercial } from "@/lib/intelligence/commercial";
import { prospectFromLeadFields } from "@/lib/intelligence/prospect";
import { resolveOutreachFromAddress } from "@/lib/outreach/email-brand";
import { buildColdEmailHtml, buildColdEmailText } from "@/lib/outreach/email-html-card";
import { rfc822 } from "@/lib/outreach/email-mime";
import { countSentToday, getOutreachEnginePolicy, markStepSent } from "@/lib/outreach/sequence";
import {
  hasSenderPool,
  nextSenderAccount,
  recordSenderSend,
  senderGmailClient,
} from "@/lib/outreach/sender-accounts";

export class SenderCapsReachedError extends Error {
  constructor() {
    super("SENDER_CAPS_REACHED: every connected sender inbox has reached its daily limit (or is disabled). Try again tomorrow or raise a limit in Settings → Sender inboxes.");
    this.name = "SenderCapsReachedError";
  }
}

export { rfc822 } from "@/lib/outreach/email-mime";

export function connectionHasGmailSend(scopes: string[] | null | undefined) {
  return Boolean(scopes?.some((scope) => scope.includes("gmail.send")));
}

export async function gmailSendConnected() {
  if (await hasSenderPool()) return true;
  const connection = await prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } });
  return connectionHasGmailSend(connection?.scopes);
}

export async function sendGmailMessage(input: {
  to: string;
  subject: string;
  body: string;
  html?: string | null;
  fromOverride?: string | null;
  replyTo?: string | null;
  draftId?: string | null;
}) {
  // Multi-inbox pool: when sender inboxes are connected, round-robin across them with per-inbox caps.
  let poolAccountId: string | null = null;
  let auth;
  let connectedEmail: string | null;
  if (await hasSenderPool()) {
    const picked = await nextSenderAccount();
    if (!picked) throw new SenderCapsReachedError();
    const { client, account } = await senderGmailClient(picked.id);
    auth = client;
    connectedEmail = account.email;
    poolAccountId = account.id;
  } else {
    const { client, connection } = await getGoogleClient();
    auth = client;
    connectedEmail = connection.googleEmail;
  }
  const gmail = google.gmail({ version: "v1", auth });
  const brand = resolveOutreachFromAddress({ connectedEmail, envFrom: poolAccountId ? connectedEmail : undefined });
  const from = input.fromOverride?.trim() || brand.header;
  const replyTo = input.replyTo?.trim() || brand.email;
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: rfc822({
        to: input.to,
        from,
        subject: input.subject,
        body: input.body,
        html: input.html,
        replyTo,
      }),
    },
  });
  if (poolAccountId) await recordSenderSend(poolAccountId, { draftId: input.draftId, messageId: sent.data.id ?? null });
  return {
    id: sent.data.id ?? null,
    threadId: sent.data.threadId ?? null,
    from,
    replyTo,
    senderAccountId: poolAccountId,
  };
}

export async function sendApprovedDraft(
  draftId: string,
  input: { explicitApproval: boolean; command?: string; operatorBulkEmail?: boolean },
) {
  const draft = await prisma.outreachDraft.findUnique({
    where: { id: draftId },
    include: {
      lead: { include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } } },
      sequenceStep: { include: { sequence: true } },
    },
  });
  if (!draft) throw new Error("Draft not found.");
  if (draft.stepKind === "TEST_TRANSPORT") {
    return {
      ok: false as const,
      sent: false,
      code: "NOT_TEST_TRANSPORT",
      message: "Use the test-transport path with SEND TEST EMAIL. Production send will not send this labeled test.",
    };
  }
  if (draft.status === "SENT" || draft.gmailMessageId) {
    return { ok: true as const, sent: false, code: "ALREADY_SENT", message: "This draft was already sent." };
  }
  const alreadySent = await prisma.outreachEvent.findFirst({
    where: { draftId, type: "SENT" },
  });
  if (alreadySent) {
    return { ok: true as const, sent: false, code: "ALREADY_SENT", message: "This draft was already sent." };
  }
  assertExternalActionAllowed(draft.status);

  const policy = await getOutreachEnginePolicy();
  const [sentToday, gmailOk, suppression] = await Promise.all([
    countSentToday(),
    gmailSendConnected(),
    readSuppressionState({
      email: draft.lead.email,
      websiteHost: draft.lead.websiteHost,
      phone: draft.lead.phone,
    }),
  ]);
  const latestAudit = draft.lead.audits[0];
  const research = await prisma.leadResearch.findFirst({
    where: { leadId: draft.leadId },
    orderBy: { createdAt: "desc" },
  });
  const { findingsToClaims } = await import("@/lib/intelligence/evidence");
  const commercial = qualifyCommercial(
    prospectFromLeadFields({
      ...draft.lead,
      evidence: findingsToClaims(research?.findings),
    }),
  );
  const gate = canSendMessage({
    policy,
    sentToday,
    activeSequences: 0,
    auditVerdict: latestAudit?.verdict ?? null,
    auditedAt: latestAudit?.createdAt ?? null,
    quotaBypassAudit: auditLooksLikeQuotaPass(latestAudit?.checks, latestAudit?.summary),
    commercialScore: commercial.total,
    commercialPriority: commercial.priority,
    whyNowType: commercial.brief.triggerEvidence.find((item) => item.type === "FACT")?.type ?? null,
    whyNowSourceUrl: commercial.brief.triggerEvidence.find((item) => item.type === "FACT")?.sourceUrl ?? null,
    whyNowSnippet: commercial.brief.triggerEvidence.find((item) => item.type === "FACT")?.snippet ?? null,
    recommendedOffer: commercial.brief.recommendedOffer,
    decisionMakerConfidence: commercial.brief.decisionMakerConfidence,
    triggerFreshness: commercial.brief.triggerFreshness,
    leadStatus: draft.lead.status,
    testRecipientConfirmed: draft.lead.testRecipient,
    testRecipientSend: draft.lead.testRecipient,
    suppressed: draft.lead.suppressed || suppression === "suppressed",
    unsubscribed: suppression === "suppressed",
    suppressionUnknown: suppression === "unknown",
    alreadySentDraft: false,
    draftStatus: draft.status,
    channel: draft.channel,
    gmailSendConnected: gmailOk,
    sequenceStatus: draft.sequenceStep?.sequence.status ?? (draft.stepKind === "REPLY" ? "ACTIVE" : "ACTIVE"),
    sequenceStopReason: draft.sequenceStep?.sequence.stopReason ?? null,
    commandForbidsSend: Boolean(input.command && /do not send|don't send|draft only/i.test(input.command)),
    operatorBulkEmail: input.operatorBulkEmail === true,
  });
  if (!gate.ok) {
    await writeAudit({
      action: "outreach.send.blocked",
      entity: "outreach_draft",
      entityId: draftId,
      payload: { code: gate.code, reason: gate.reason },
    });
    return { ok: false as const, sent: false, code: gate.code, message: gate.reason };
  }
  if (!input.explicitApproval && policy.sendMode !== "auto") {
    await writeAudit({
      action: "outreach.send.blocked",
      entity: "outreach_draft",
      entityId: draftId,
      payload: { code: "NOT_APPROVED", reason: "Explicit approval is required to send." },
    });
    return { ok: false as const, sent: false, code: "NOT_APPROVED", message: "Explicit approval is required to send." };
  }
  if (!draft.lead.email) {
    return { ok: false as const, sent: false, code: "NO_EMAIL", message: "Lead has no email." };
  }

  const claimToken = `pending:${draftId}`;
  const claimed = await prisma.outreachDraft.updateMany({
    where: { id: draftId, status: "APPROVED", gmailMessageId: null },
    data: { gmailMessageId: claimToken },
  });
  if (claimed.count !== 1) {
    return { ok: true as const, sent: false, code: "ALREADY_SENT", message: "This draft was already claimed for send." };
  }

  const usePremiumCard = draft.channel === "EMAIL" && draft.stepKind !== "REPLY";
  const cardInput = {
    message: draft.message,
    recipientName: draft.lead.name,
    company: draft.lead.company,
  };
  const plainBody = usePremiumCard ? buildColdEmailText(cardInput) : draft.message;
  const htmlBody = usePremiumCard ? buildColdEmailHtml(cardInput) : null;

  try {
    const sent = await sendGmailMessage({
      to: draft.lead.email,
      subject: draft.subject || `Note for ${draft.lead.company || draft.lead.name || "you"}`,
      body: plainBody,
      html: htmlBody,
      draftId,
    });

    await prisma.outreachDraft.update({
      where: { id: draftId },
      data: { status: "SENT", gmailMessageId: sent.id ?? `sent-${draftId}` },
    });
    await prisma.lead.update({
      where: { id: draft.leadId },
      data: { status: draft.stepKind === "REPLY" ? draft.lead.status : "CONTACTED", lastActivityAt: new Date() },
    });
    await prisma.outreachEvent.create({
      data: {
        leadId: draft.leadId,
        draftId,
        type: "SENT",
        channel: draft.channel,
        payload: {
          gmailMessageId: sent.id ?? null,
          threadId: sent.threadId ?? null,
          from: sent.from,
          replyTo: sent.replyTo,
          htmlCard: Boolean(htmlBody),
        },
      },
    });
    if (draft.sequenceStep) await markStepSent(draft.sequenceStep.id);
    await writeAudit({
      action: "outreach.send",
      entity: "outreach_draft",
      entityId: draftId,
      payload: {
        channel: draft.channel,
        gmailMessageId: sent.id ?? null,
        leadId: draft.lead.leadId,
        from: sent.from,
        htmlCard: Boolean(htmlBody),
      },
    });
    const { recordLeadOutcome } = await import("@/lib/intelligence/outcome");
    await recordLeadOutcome({
      leadId: draft.leadId,
      channel: draft.channel,
      draftId,
      decisionId: draft.decisionId,
      traceId: draft.traceId,
      patch: { sent: true, noResponse: true, delivered: null },
    });
    await import("@/lib/google/sync")
      .then((mod) => mod.syncLeadsWorkbook())
      .catch(() => null);
    return { ok: true as const, sent: true, code: "SENT", message: `Email sent to ${draft.lead.email} from ${sent.from}.` };
  } catch (error) {
    await prisma.outreachDraft.updateMany({
      where: { id: draftId, gmailMessageId: claimToken },
      data: { gmailMessageId: null },
    });
    await writeAudit({
      action: "outreach.send.blocked",
      entity: "outreach_draft",
      entityId: draftId,
      payload: { code: "SEND_FAILED", reason: error instanceof Error ? error.message : "Gmail send failed" },
    });
    return {
      ok: false as const,
      sent: false,
      code: "SEND_FAILED",
      message: error instanceof Error ? error.message : "Gmail send failed.",
    };
  }
}
