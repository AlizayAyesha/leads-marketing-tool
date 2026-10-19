"use server";

import { revalidatePath } from "next/cache";
import type { OutreachChannel } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { GoogleAdapter, GoogleSheetsError } from "@/lib/data-sources/google";
import { getSheetConfig } from "@/lib/google/sync";
import { ingestLeads } from "@/lib/leads/ingest";
import { normalizeLead } from "@/lib/leads/normalize";
import { parseTestRecipientFlag } from "@/lib/outreach/test-recipient";
import { getAgent } from "@/lib/agents/registry";
import { runLeadPipeline } from "@/lib/pipeline/run";
import { enrollSequence } from "@/lib/outreach/sequence";
import { prepareTestTransportDraft, sendTestTransportEmail } from "@/lib/outreach/test-transport-send";
import { readSuppressionState } from "@/lib/db/settings";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import type { ColumnMap } from "@/types";
import {
  DEFAULT_TEST_SESSION,
  disableTestRecipientMode,
  getTestRecipientSession,
  isConfirmedTestRecipient,
  saveTestRecipientSession,
} from "@/lib/outreach/test-recipient";

function revalidate() {
  revalidatePath("/outreach");
  revalidatePath("/leads");
  revalidatePath("/jarvis");
}

export type TestRecipientPreview = {
  name: string | null;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  website: string | null;
  leadId?: string | null;
  publicLeadId?: string | null;
  source: "sheet" | "postgres";
};

export async function discoverTestRecipientAction() {
  const config = await getSheetConfig();
  if (!config) {
    return { ok: false as const, message: "No Google Sheet is configured.", recipients: [] as TestRecipientPreview[] };
  }
  const adapter = new GoogleAdapter();
  let acquired;
  try {
    acquired = await adapter.acquire({
      spreadsheetId: config.spreadsheetId,
      worksheet: config.worksheets.leads,
      columnMap: config.columnMap as ColumnMap,
    });
  } catch (error) {
    if (!(error instanceof GoogleSheetsError)) throw error;
    return { ok: false as const, message: error.message, recipients: [] as TestRecipientPreview[] };
  }
  const marked = acquired.data
    .map((raw) => normalizeLead(raw))
    .filter((lead) => parseTestRecipientFlag(lead.testRecipient, lead.notes));
  if (marked.length === 0) {
    return {
      ok: false as const,
      message:
        "No test recipient is marked. Add a Leads column “Test recipient” with true, or put testRecipient=true in Notes, for exactly one row.",
      recipients: [] as TestRecipientPreview[],
    };
  }
  if (marked.length > 1) {
    return {
      ok: false as const,
      message: `${marked.length} rows are marked as test recipients. Mark exactly one.`,
      recipients: marked.map((lead) => ({
        name: lead.name,
        company: lead.company,
        email: lead.email,
        linkedinUrl: lead.linkedinUrl,
        instagramUrl: lead.instagramUrl,
        website: lead.website,
        source: "sheet" as const,
      })),
    };
  }
  const ingest = await ingestLeads({
    leads: acquired.data.filter((raw) => {
      const normalized = normalizeLead(raw);
      return parseTestRecipientFlag(normalized.testRecipient, normalized.notes);
    }),
    sourceId: config.sourceId ?? null,
    sourceName: "google-sheets",
  });
  const selected = marked[0];
  const lead = await prisma.lead.findFirst({
    where: {
      OR: [
        selected.email ? { email: selected.email } : undefined,
        selected.websiteHost ? { websiteHost: selected.websiteHost } : undefined,
        selected.linkedinUrl ? { linkedinUrl: selected.linkedinUrl } : undefined,
      ].filter(Boolean) as object[],
    },
  });
  if (!lead) {
    return { ok: false as const, message: "Test recipient did not land in Postgres.", recipients: [] as TestRecipientPreview[] };
  }
  await prisma.lead.updateMany({ data: { testRecipient: false } });
  await prisma.lead.update({ where: { id: lead.id }, data: { testRecipient: true } });
  await saveTestRecipientSession({
    ...DEFAULT_TEST_SESSION,
    enabled: true,
    leadId: lead.id,
    publicLeadId: lead.leadId,
  });
  await writeAudit({
    action: "TEST_RECIPIENT_DISCOVERED",
    entity: "lead",
    entityId: lead.id,
    payload: { publicLeadId: lead.leadId, ingest },
  });
  revalidate();
  return {
    ok: true as const,
    message: "One test recipient found. Confirm identity before any send.",
    recipients: [
      {
        name: lead.name,
        company: lead.company,
        email: lead.email,
        linkedinUrl: lead.linkedinUrl,
        instagramUrl: lead.instagramUrl,
        website: lead.website,
        leadId: lead.id,
        publicLeadId: lead.leadId,
        source: "postgres" as const,
      },
    ],
  };
}

export async function confirmTestOutreachAction(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead?.testRecipient) {
    return { ok: false as const, message: "That lead is not the designated test recipient." };
  }
  const marked = await prisma.lead.count({ where: { testRecipient: true } });
  if (marked !== 1) {
    return { ok: false as const, message: "Test recipient must be exactly one lead." };
  }
  const session = await getTestRecipientSession();
  if (!session.enabled || session.leadId !== lead.id) {
    return { ok: false as const, message: "Discover the marked Sheet row first. Do not infer test status." };
  }
  if (!lead.email && !lead.linkedinUrl && !lead.instagramUrl) {
    return { ok: false as const, message: "Test recipient identity is incomplete — no email, LinkedIn, or Instagram." };
  }
  await saveTestRecipientSession({
    ...session,
    confirmedAt: new Date().toISOString(),
  });
  await writeAudit({
    action: "TEST_OUTREACH_APPROVED",
    entity: "lead",
    entityId: lead.id,
    payload: {
      publicLeadId: lead.leadId,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      linkedinUrl: lead.linkedinUrl,
      instagramUrl: lead.instagramUrl,
    },
  });
  revalidate();
  return { ok: true as const, message: "TEST_OUTREACH_APPROVED recorded. Global kill switch stays on." };
}

export async function prepareTestRecipientAction(leadId: string) {
  if (!(await isConfirmedTestRecipient(leadId))) {
    return { ok: false as const, message: "Confirm the test recipient before generating drafts." };
  }
  const pipeline = await runLeadPipeline(leadId, { engine: true, forceRefresh: true });
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      research: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const prompt = await prisma.prompt.findUnique({ where: { agentSlug: "outreach_writer" } });
  const channels: OutreachChannel[] = [];
  if (lead.email) channels.push("EMAIL");
  if (lead.linkedinUrl) channels.push("LINKEDIN");
  if (lead.instagramUrl) channels.push("INSTAGRAM");
  const drafts: Record<string, string | null> = {};
  for (const channel of channels) {
    const result = await getAgent("outreach_writer").execute({
      lead,
      prompt: prompt?.content ?? DEFAULT_PROMPTS.outreach_writer.content,
      payload: { channel, stepKind: "INITIAL" },
    });
    const output = (result.output ?? {}) as { draftId?: string; skipped?: boolean };
    drafts[channel] = output.draftId ?? null;
  }
  const emailDraftId = drafts.EMAIL ?? null;
  if (emailDraftId) {
    const suppression = await readSuppressionState({
      email: lead.email,
      websiteHost: lead.websiteHost,
      phone: lead.phone,
    });
    await enrollSequence({
      leadId: lead.id,
      channel: "EMAIL",
      auditVerdict: lead.audits[0]?.verdict ?? null,
      auditedAt: lead.audits[0]?.createdAt ?? null,
      leadStatus: lead.status,
      suppressed: lead.suppressed || suppression === "suppressed",
      unsubscribed: suppression === "suppressed",
      suppressionUnknown: suppression === "unknown",
      draftId: emailDraftId,
    });
  }
  const session = await getTestRecipientSession();
  await saveTestRecipientSession({
    ...session,
    emailDraftId,
    linkedinStatus: lead.linkedinUrl ? "draft" : "unavailable",
    instagramStatus: lead.instagramUrl ? "draft" : "unavailable",
  });
  revalidate();
  return {
    ok: true as const,
    pipeline,
    decision: lead.audits[0]?.verdict ?? null,
    decisionReason: lead.audits[0]?.summary ?? null,
    problem: lead.opportunities[0]?.problem ?? null,
    evidence: lead.opportunities[0]?.evidence ?? lead.research[0]?.websiteQualityNotes ?? null,
    service: lead.opportunities[0]?.recommendedService ?? null,
    drafts,
  };
}

export async function prepareTestTransportAction(leadId: string) {
  const result = await prepareTestTransportDraft(leadId);
  revalidate();
  return result;
}

export async function sendTestTransportAction(draftId: string, command: string) {
  const result = await sendTestTransportEmail({ draftId, command });
  revalidate();
  return result;
}

export async function sendTestEmailAction(draftId: string) {
  return sendTestTransportAction(draftId, "");
}

export async function sendLinkedInTestFormAction(kind: "connection" | "message") {
  const { sendLinkedInTestAction } = await import("@/lib/linkedin/test-send-run");
  const result = await sendLinkedInTestAction(kind);
  revalidate();
  return result;
}

export async function checkLinkedInTestStatusAction() {
  const session = await getTestRecipientSession();
  if (!session.leadId || !(await isConfirmedTestRecipient(session.leadId))) {
    return { ok: false as const, message: "Confirm the isolated test recipient first. Status was not checked." };
  }
  const { checkLinkedInConnectionStatus } = await import("@/lib/linkedin/connection/lifecycle");
  const result = await checkLinkedInConnectionStatus(session.leadId);
  revalidate();
  return {
    ok: result.ok,
    message: result.ok
      ? `LinkedIn status is ${result.status}. REQUESTED is not CONNECTED.`
      : result.reason,
    status: "status" in result ? result.status : null,
  };
}

export async function ingestLinkedInTestReplyAction() {
  const session = await getTestRecipientSession();
  if (!session.leadId || !(await isConfirmedTestRecipient(session.leadId))) {
    return { ok: false as const, message: "Confirm the isolated test recipient first. Inbox was not read." };
  }
  const { syncLinkedInInboxForLead } = await import("@/lib/linkedin/session/sync");
  const result = await syncLinkedInInboxForLead(session.leadId);
  revalidate();
  if (!result.ok) return { ok: false as const, message: `Inbox not read (${result.code}).` };
  return {
    ok: true as const,
    message: result.ingested
      ? "Inbound LinkedIn reply was passed to the sales conversation engine."
      : "No new inbound LinkedIn reply was found. Nothing was invented.",
  };
}

export async function approveLinkedInTestSendAction() {
  return sendLinkedInTestFormAction("connection");
}

export async function approveInstagramTestSendAction() {
  await writeAudit({
    action: "TEST_INSTAGRAM_UNAVAILABLE",
    entity: "setting",
    payload: {
      reason: "No official Instagram send adapter. DMs stay draft-only.",
    },
  });
  return {
    ok: false as const,
    status: "UNAVAILABLE" as const,
    message: "Instagram remains draft-only. There is no official DM adapter; Jarvis will not bypass that.",
  };
}

export async function completeTestRecipientModeAction() {
  await disableTestRecipientMode("operator_complete");
  revalidate();
  return { ok: true as const, message: "Test recipient mode disabled. Kill switch and draft-only restored." };
}
