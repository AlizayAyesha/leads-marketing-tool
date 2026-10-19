import "server-only";

import { prisma } from "@/lib/db/prisma";
import { mapRows, readWorksheetDetailed } from "@/lib/data-sources/google";
import { getSheetConfig } from "@/lib/google/sync";
import { identityLeadMap } from "@/lib/google/workbook";
import { writeAudit, readSuppressionState } from "@/lib/db/settings";
import { countSentToday, getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { gmailSendConnected, sendGmailMessage } from "@/lib/outreach/send";
import {
  disableTestRecipientMode,
  getTestRecipientSession,
  isConfirmedTestRecipient,
  saveTestRecipientSession,
} from "@/lib/outreach/test-recipient";
import { parseTestRecipientFlag } from "@/lib/outreach/test-flag";
import {
  TEST_TRANSPORT_STEP,
  TEST_TRANSPORT_SUBJECT,
  buildTestTransportEmail,
  canSendTestTransport,
} from "@/lib/outreach/test-transport";
import { startTrace } from "@/lib/intelligence/trace";
import { normalizeLead } from "@/lib/leads/normalize";
import type { ColumnMap } from "@/types";

export async function readMarkedSheetRecipients() {
  const config = await getSheetConfig();
  if (!config) {
    return { ok: false as const, message: "No Google Sheet is configured.", marked: [] as ReturnType<typeof normalizeLead>[] };
  }
  const sheet = await readWorksheetDetailed(config.spreadsheetId, config.worksheets.leads);
  const leads = mapRows(sheet.rows, (config.columnMap ?? identityLeadMap()) as ColumnMap).map(normalizeLead);
  const marked = leads.filter((lead) => parseTestRecipientFlag(lead.testRecipient, lead.notes));
  return { ok: true as const, spreadsheetId: config.spreadsheetId, worksheet: config.worksheets.leads, marked };
}

export async function prepareTestTransportDraft(leadId: string) {
  if (!(await isConfirmedTestRecipient(leadId))) {
    return { ok: false as const, message: "Confirm the test recipient identity first." };
  }
  const sheet = await readMarkedSheetRecipients();
  if (!sheet.ok) return { ok: false as const, message: sheet.message };
  if (sheet.marked.length !== 1) {
    return {
      ok: false as const,
      message:
        sheet.marked.length === 0
          ? "No test recipient is marked on the Sheet."
          : `${sheet.marked.length} rows are marked. Mark exactly one.`,
    };
  }
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead?.email || !lead.testRecipient) {
    return { ok: false as const, message: "Test recipient is missing or has no email." };
  }
  const marked = sheet.marked[0];
  if ((marked.email ?? "").toLowerCase() !== lead.email.toLowerCase()) {
    return { ok: false as const, message: "Sheet identity does not match the confirmed test recipient." };
  }
  const content = buildTestTransportEmail({ name: lead.name, email: lead.email });
  await prisma.outreachDraft.updateMany({
    where: { leadId, channel: "EMAIL", stepKind: TEST_TRANSPORT_STEP, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    data: { status: "SUPERSEDED" },
  });
  const trace = await startTrace(leadId);
  const draft = await prisma.outreachDraft.create({
    data: {
      leadId,
      channel: "EMAIL",
      subject: content.subject,
      message: content.message,
      status: "PENDING_APPROVAL",
      stepKind: TEST_TRANSPORT_STEP,
      reasonForContacting: "Test-only Gmail transport validation. Not cold outreach.",
      firstMessageGoal: "Prove Gmail send infrastructure with one authorized test recipient.",
      evidenceRefs: ["test-transport"],
      traceId: trace.id,
      mode: "test_transport",
    },
  });
  const session = await getTestRecipientSession();
  await saveTestRecipientSession({ ...session, emailDraftId: draft.id });
  await writeAudit({
    action: "TEST_TRANSPORT_DRAFT_PREPARED",
    entity: "outreach_draft",
    entityId: draft.id,
    payload: { leadId: lead.leadId, email: lead.email, subject: draft.subject, traceId: trace.id },
  });
  return {
    ok: true as const,
    message: "Labeled test email prepared. Nothing was sent. Reply SEND TEST EMAIL to send.",
    draft: {
      id: draft.id,
      subject: draft.subject,
      message: draft.message,
      to: lead.email,
      name: lead.name,
      traceId: trace.id,
    },
  };
}

export async function sendTestTransportEmail(input: { draftId: string; command: string }) {
  const draft = await prisma.outreachDraft.findUnique({
    where: { id: input.draftId },
    include: { lead: true },
  });
  if (!draft) return { ok: false as const, sent: false, code: "NOT_FOUND", message: "Draft not found." };

  const [sheet, session, policy, gmailOk, sentToday, postgresMarkedCount, suppression] = await Promise.all([
    readMarkedSheetRecipients(),
    getTestRecipientSession(),
    getOutreachEnginePolicy(),
    gmailSendConnected(),
    countSentToday(),
    prisma.lead.count({ where: { testRecipient: true } }),
    readSuppressionState({
      email: draft.lead.email,
      websiteHost: draft.lead.websiteHost,
      phone: draft.lead.phone,
    }),
  ]);
  const marked = sheet.ok ? sheet.marked[0] : null;
  const alreadySent = Boolean(
    draft.status === "SENT" ||
      draft.gmailMessageId ||
      (await prisma.outreachEvent.findFirst({ where: { draftId: draft.id, type: "SENT" } })),
  );
  const gate = canSendTestTransport({
    markedCount: sheet.ok ? sheet.marked.length : 0,
    markedEmail: marked?.email ?? null,
    markedName: marked?.name ?? null,
    postgresMarkedCount,
    session,
    leadId: draft.lead.id,
    leadEmail: draft.lead.email,
    leadName: draft.lead.name,
    leadTestRecipient: draft.lead.testRecipient,
    suppressed: draft.lead.suppressed || suppression === "suppressed",
    unsubscribed: suppression === "suppressed",
    suppressionUnknown: suppression === "unknown",
    leadStatus: draft.lead.status,
    draftLeadId: draft.leadId,
    draftRecipientEmail: draft.lead.email,
    draftSubject: draft.subject,
    draftMessage: draft.message,
    draftStepKind: draft.stepKind,
    draftStatus: draft.status,
    draftAlreadySent: alreadySent,
    channel: draft.channel,
    policy,
    gmailSendConnected: gmailOk,
    sentToday,
    command: input.command,
    explicitApproval: true,
  });
  if (!gate.ok) {
    await writeAudit({
      action: "outreach.send.blocked",
      entity: "outreach_draft",
      entityId: draft.id,
      payload: { code: gate.code, reason: gate.reason, path: "test_transport" },
    });
    return { ok: false as const, sent: false, code: gate.code, message: gate.reason };
  }

  await prisma.outreachDraft.update({
    where: { id: draft.id },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: "operator-test-transport" },
  });

  const claimToken = `pending:${draft.id}`;
  const claimed = await prisma.outreachDraft.updateMany({
    where: { id: draft.id, status: "APPROVED", gmailMessageId: null, stepKind: TEST_TRANSPORT_STEP },
    data: { gmailMessageId: claimToken },
  });
  if (claimed.count !== 1) {
    return { ok: true as const, sent: false, code: "ALREADY_SENT", message: "This test email was already claimed for send." };
  }

  try {
    const sent = await sendGmailMessage({
      to: draft.lead.email!,
      subject: draft.subject || TEST_TRANSPORT_SUBJECT,
      body: draft.message,
    });
    const sentAt = new Date();
    await prisma.outreachDraft.update({
      where: { id: draft.id },
      data: { status: "SENT", gmailMessageId: sent.id ?? `sent-${draft.id}` },
    });
    const event = await prisma.outreachEvent.create({
      data: {
        leadId: draft.leadId,
        draftId: draft.id,
        type: "SENT",
        channel: "EMAIL",
        payload: {
          testTransport: true,
          gmailMessageId: sent.id,
          threadId: sent.threadId,
          recipient: draft.lead.email,
          from: sent.from,
        },
      },
    });
    await writeAudit({
      action: "TEST_TRANSPORT_SENT",
      entity: "outreach_draft",
      entityId: draft.id,
      payload: {
        gmailMessageId: sent.id,
        recipient: draft.lead.email,
        leadId: draft.lead.leadId,
        traceId: draft.traceId,
        eventId: event.id,
      },
    });
    await saveTestRecipientSession({
      ...session,
      emailDraftId: draft.id,
      emailSentAt: sentAt.toISOString(),
      emailGmailMessageId: sent.id,
      linkedinStatus: "unavailable",
      instagramStatus: "unavailable",
    });
    await disableTestRecipientMode("test_transport_sent");
    return {
      ok: true as const,
      sent: true,
      code: "SENT",
      message: `Test transport email sent to ${draft.lead.email}.`,
      gmailMessageId: sent.id,
      recipient: draft.lead.email,
      from: sent.from,
      timestamp: sentAt.toISOString(),
      draftId: draft.id,
      traceId: draft.traceId,
      eventId: event.id,
    };
  } catch (error) {
    await prisma.outreachDraft.updateMany({
      where: { id: draft.id, gmailMessageId: claimToken },
      data: { gmailMessageId: null, status: "PENDING_APPROVAL" },
    });
    await writeAudit({
      action: "outreach.send.blocked",
      entity: "outreach_draft",
      entityId: draft.id,
      payload: { code: "SEND_FAILED", reason: error instanceof Error ? error.message : "Gmail send failed", path: "test_transport" },
    });
    return {
      ok: false as const,
      sent: false,
      code: "SEND_FAILED",
      message: error instanceof Error ? error.message : "Gmail send failed.",
    };
  }
}
