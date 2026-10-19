import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { composeLinkedInConnectionNote, composeLinkedInFollowUpMessage } from "@/lib/linkedin/daily/copy";
import {
  LINKEDIN_TEST_CONNECTION_SENT_EVENT,
  LINKEDIN_TEST_MESSAGE_SENT_EVENT,
} from "@/lib/linkedin/daily/events";
import { linkedInLocalDayKey } from "@/lib/linkedin/daily/authorize";
import { resolveLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import type { LinkedInSendKind } from "@/lib/linkedin/send/types";
import { authorizeLinkedInTestSend, linkedInTestIdempotencyKey } from "@/lib/linkedin/test-send";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import {
  getTestRecipientSession,
  isConfirmedTestRecipient,
  saveTestRecipientSession,
} from "@/lib/outreach/test-recipient";

export async function sendLinkedInTestAction(kind: LinkedInSendKind) {
  const session = await getTestRecipientSession();
  if (!session.leadId) {
    return {
      ok: false as const,
      sent: false,
      code: "TEST_MODE_OFF",
      message: "Load and confirm a test recipient first. Nothing was sent.",
    };
  }
  const [lead, marked, policy, sendProvider] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: session.leadId },
      include: {
        audits: { orderBy: { createdAt: "desc" }, take: 1 },
        linkedinConnections: { take: 1 },
      },
    }),
    prisma.lead.count({ where: { testRecipient: true } }),
    getOutreachEnginePolicy(),
    resolveLinkedInSendProvider(),
  ]);
  if (!lead) {
    return { ok: false as const, sent: false, code: "LEAD_MISSING", message: "Test recipient lead was not found." };
  }

  const confirmed = await isConfirmedTestRecipient(lead.id);
  const auth = authorizeLinkedInTestSend({
    testModeEnabled: session.enabled,
    confirmedAt: confirmed ? session.confirmedAt : null,
    sessionLeadId: session.leadId,
    leadId: lead.id,
    testRecipient: lead.testRecipient,
    markedTestRecipients: marked,
    killSwitchOn: policy.sendsPaused,
    sendProviderReady: sendProvider.configured,
    linkedinUrl: lead.linkedinUrl,
    suppressed: lead.suppressed,
    leadStatus: lead.status,
  });
  if (!auth.canSend) {
    await writeAudit({
      action: "TEST_LINKEDIN_BLOCKED",
      entity: "lead",
      entityId: lead.id,
      payload: {
        code: auth.code,
        reason: auth.reason,
        kind,
        publicLeadId: lead.leadId,
        decisionMaker: lead.audits[0]?.verdict ?? null,
        sendProvider: sendProvider.id,
      },
    });
    return { ok: false as const, sent: false, code: auth.code, message: auth.reason };
  }

  const body =
    kind === "connection"
      ? composeLinkedInConnectionNote({
          id: lead.id,
          leadId: lead.leadId,
          name: lead.name,
          company: lead.company,
          linkedinUrl: lead.linkedinUrl,
          rank: 1,
          rankScore: 0,
          qualificationScore: 0,
          temperature: lead.temperature,
          connectionStatus: lead.linkedinConnections[0]?.status ?? "NOT_REQUESTED",
          researchStatus: null,
          reasons: ["isolated-linkedin-test"],
          purpose: "connection",
        })
      : composeLinkedInFollowUpMessage({
          id: lead.id,
          leadId: lead.leadId,
          name: lead.name,
          company: lead.company,
          linkedinUrl: lead.linkedinUrl,
          rank: 1,
          rankScore: 0,
          qualificationScore: 0,
          temperature: lead.temperature,
          connectionStatus: lead.linkedinConnections[0]?.status ?? "NOT_REQUESTED",
          researchStatus: null,
          reasons: ["isolated-linkedin-test"],
          purpose: "message",
        });

  const result = await sendProvider.send({
    leadId: lead.id,
    profileUrl: lead.linkedinUrl ?? "",
    kind,
    body,
    idempotencyKey: linkedInTestIdempotencyKey({
      leadId: lead.id,
      kind,
      day: linkedInLocalDayKey(),
    }),
  });

  const payload = {
    test: true,
    kind,
    body,
    provider: result.provider,
    externalId: result.externalId ?? null,
    code: result.code,
    reason: result.reason,
    publicLeadId: lead.leadId,
    name: lead.name,
    linkedinUrl: lead.linkedinUrl,
    decisionMaker: lead.audits[0]?.verdict ?? null,
    decisionMakerUnchanged: true,
    evidence: result.evidence ?? null,
  };

  await writeAudit({
    action: result.sent ? "TEST_LINKEDIN_SENT" : "TEST_LINKEDIN_FAILED",
    entity: "lead",
    entityId: lead.id,
    payload,
  });

  if (result.sent) {
    await prisma.outreachEvent.create({
      data: {
        leadId: lead.id,
        type: kind === "connection" ? LINKEDIN_TEST_CONNECTION_SENT_EVENT : LINKEDIN_TEST_MESSAGE_SENT_EVENT,
        channel: "LINKEDIN",
        payload: payload as Prisma.InputJsonValue,
      },
    });
    if (kind === "connection") {
      await prisma.linkedInConnection.upsert({
        where: { leadId: lead.id },
        update: {
          status: "REQUESTED",
          connectionRequestedAt: new Date(),
          statusSource: result.provider,
          lastCheckResult: result.code,
        },
        create: {
          leadId: lead.id,
          status: "REQUESTED",
          profileUrl: lead.linkedinUrl,
          connectionRequestedAt: new Date(),
          statusSource: result.provider,
          lastCheckResult: result.code,
        },
      });
    }
    const sentAt = new Date().toISOString();
    await saveTestRecipientSession({
      ...session,
      linkedinStatus: "sent",
      lastLinkedinTest: {
        kind,
        provider: result.provider,
        externalId: result.externalId ?? null,
        sentAt,
        code: result.code,
        reason: result.reason,
      },
    });
  }

  return {
    ok: result.ok,
    sent: result.sent,
    code: result.code,
    message: result.sent
      ? `Authorized provider confirmed the test ${kind}. Production Decision Maker stays ${lead.audits[0]?.verdict ?? "unchanged"}.`
      : result.reason,
    provider: result.provider,
    externalId: result.externalId ?? null,
    decisionMaker: lead.audits[0]?.verdict ?? null,
  };
}
