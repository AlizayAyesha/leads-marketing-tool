import "server-only";

import type { Prisma } from "@prisma/client";

import { appendProviderSendMessage, extractLinkedInCta, parseConversationMessages } from "@/lib/analytics/evidence";
import { prisma } from "@/lib/db/prisma";

export async function recordLinkedInSendTrace(input: {
  leadId: string;
  kind: "connection" | "message";
  body: string;
  provider: string;
  externalId?: string | null;
  profileUrl?: string | null;
}) {
  const existing = await prisma.conversation.findFirst({
    where: { leadId: input.leadId, channel: "LINKEDIN" },
    orderBy: { updatedAt: "desc" },
  });
  const { messages, appended } = appendProviderSendMessage(parseConversationMessages(existing?.messages), input);
  const cta = extractLinkedInCta(input.body);
  const keepStage = existing && existing.stage !== "NONE";
  const data = {
    messages: messages as unknown as Prisma.InputJsonValue,
    meetingEntryUrl: cta ?? existing?.meetingEntryUrl ?? null,
    meetingSource:
      existing?.meetingSource && existing.meetingSource !== "UNKNOWN"
        ? existing.meetingSource
        : cta
          ? "LINKEDIN"
          : (existing?.meetingSource ?? "UNKNOWN"),
    stage: keepStage ? existing.stage : input.kind === "message" ? "CONNECTED" : "NONE",
  };
  if (!appended && existing) return existing.id;
  if (existing) {
    await prisma.conversation.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.conversation.create({
    data: {
      leadId: input.leadId,
      channel: "LINKEDIN",
      ...data,
    },
  });
  return created.id;
}
