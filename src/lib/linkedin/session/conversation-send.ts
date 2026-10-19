import "server-only";

import { prisma } from "@/lib/db/prisma";
import { shouldHaltOutreachForMeeting } from "@/lib/conversation/booking";
import { CONVERSATION_REPLY_STEP, type ConversationStage } from "@/lib/conversation/types";
import { linkedInDailyIdempotencyKey, linkedInLocalDayKey } from "@/lib/linkedin/daily/authorize";
import { LINKEDIN_MESSAGE_SENT_EVENT } from "@/lib/linkedin/daily/events";
import { recordLinkedInSendTrace } from "@/lib/linkedin/daily/trace";
import type { LinkedInSendProvider } from "@/lib/linkedin/send/types";

export async function flushLinkedInConversationDrafts(input: {
  sendProvider: LinkedInSendProvider;
  now?: Date;
  remainingMessages: number;
}) {
  const now = input.now ?? new Date();
  if (!input.sendProvider.configured || input.remainingMessages <= 0) {
    return { sent: 0, skipped: 0 };
  }
  const drafts = await prisma.outreachDraft.findMany({
    where: {
      channel: "LINKEDIN",
      stepKind: CONVERSATION_REPLY_STEP,
      status: "PENDING_APPROVAL",
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: {
      lead: {
        include: {
          linkedinConnections: { take: 1 },
          conversations: { where: { channel: "LINKEDIN" }, orderBy: { updatedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  for (const draft of drafts) {
    if (sent >= input.remainingMessages) break;
    const connection = draft.lead.linkedinConnections[0];
    const stage = draft.lead.conversations[0]?.stage as ConversationStage | undefined;
    if (!draft.lead.linkedinUrl || connection?.status !== "CONNECTED" || connection.stoppedAt) {
      skipped += 1;
      continue;
    }
    if (draft.lead.suppressed || draft.lead.status === "DO_NOT_CONTACT") {
      skipped += 1;
      continue;
    }
    if (shouldHaltOutreachForMeeting(stage || "NONE")) {
      skipped += 1;
      continue;
    }
    if (!draft.message.trim()) {
      skipped += 1;
      continue;
    }

    const result = await input.sendProvider.send({
      leadId: draft.leadId,
      profileUrl: draft.lead.linkedinUrl,
      kind: "message",
      body: draft.message,
      idempotencyKey: linkedInDailyIdempotencyKey({
        leadId: draft.leadId,
        kind: "message",
        day: `${linkedInLocalDayKey(now)}:conversation:${draft.id}`,
      }),
    });
    if (!result.sent) {
      skipped += 1;
      continue;
    }
    await prisma.outreachDraft.update({
      where: { id: draft.id },
      data: { status: "SENT", approvedAt: new Date(), approvedBy: "chrome-linkedin-session" },
    });
    await prisma.outreachEvent.create({
      data: {
        leadId: draft.leadId,
        draftId: draft.id,
        type: LINKEDIN_MESSAGE_SENT_EVENT,
        channel: "LINKEDIN",
        payload: {
          kind: "message",
          body: draft.message,
          provider: result.provider,
          externalId: result.externalId ?? null,
          evidence: result.evidence ?? null,
          conversation: true,
        },
      },
    });
    await recordLinkedInSendTrace({
      leadId: draft.leadId,
      kind: "message",
      body: draft.message,
      provider: result.provider,
      externalId: result.externalId ?? null,
      profileUrl: draft.lead.linkedinUrl,
    }).catch(() => null);
    sent += 1;
  }

  return { sent, skipped };
}
