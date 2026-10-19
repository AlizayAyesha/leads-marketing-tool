import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { inspectLinkedInPage } from "@/lib/linkedin/session/inspect";
import { chromeLinkedInSessionHost } from "@/lib/linkedin/session/host";
import { extractNewInbound } from "@/lib/linkedin/session/inbox";
import { captureLinkedInEvidence } from "@/lib/linkedin/session/actions";
import { parseConversationMessages } from "@/lib/analytics/evidence";

function knownConversationTexts(messages: unknown): string[] {
  const parsed = parseConversationMessages(messages);
  return parsed.map((message) => message.text).filter((text): text is string => Boolean(text && text.trim()));
}

export async function syncLinkedInInboxForLead(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      linkedinConnections: { take: 1 },
      conversations: { where: { channel: "LINKEDIN" }, orderBy: { updatedAt: "desc" }, take: 1 },
      replies: { where: { channel: "LINKEDIN" }, orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!lead?.linkedinUrl) return { ok: false as const, ingested: false, code: "NO_URL" };
  if (lead.linkedinConnections[0]?.status !== "CONNECTED") {
    return { ok: false as const, ingested: false, code: "NOT_CONNECTED" };
  }
  if (lead.linkedinConnections[0]?.stoppedAt) {
    return { ok: false as const, ingested: false, code: "STOPPED" };
  }
  const inspectedUrl = inspectLinkedInUrl(lead.linkedinUrl);
  if (inspectedUrl.kind !== "person" || !inspectedUrl.normalizedUrl) {
    return { ok: false as const, ingested: false, code: "NOT_PERSON_URL" };
  }

  const host = chromeLinkedInSessionHost();
  if (!host.connected()) return { ok: false as const, ingested: false, code: "SESSION_DISCONNECTED" };

  const known = [
    ...knownConversationTexts(lead.conversations[0]?.messages),
    ...lead.replies.map((reply) => reply.rawText),
  ];

  const read = await host.runOnPage(async (page) => {
    await page.goto(inspectedUrl.normalizedUrl!);
    const inspected = await inspectLinkedInPage(page);
    if (inspected.state !== "CONNECTED") {
      return { inbound: null as string | null, inspected, thread: "" };
    }
    await page.clickButton(/^Message$/i);
    await page.wait(800);
    const thread = await page.innerText();
    const inbound = extractNewInbound(thread, known);
    await captureLinkedInEvidence({
      page,
      leadId: lead.id,
      profileUrl: inspectedUrl.normalizedUrl!,
      action: "inbox",
      inspected,
    });
    return { inbound, inspected, thread };
  });

  if (!read.inbound) {
    return { ok: true as const, ingested: false, code: "NO_NEW_INBOUND" };
  }

  const { ingestReply } = await import("@/lib/outreach/engine");
  const ingested = await ingestReply({ leadId: lead.id, text: read.inbound, channel: "LINKEDIN" });
  await writeAudit({
    action: "linkedin.inbox.ingested",
    entity: "lead",
    entityId: lead.id,
    payload: {
      preview: read.inbound.slice(0, 240),
      conversationStage: ingested.conversationStage,
      draftId: ingested.draftId,
    } as Prisma.InputJsonValue,
  });
  return { ok: true as const, ingested: true, code: "INGESTED", draftId: ingested.draftId, stage: ingested.conversationStage };
}

export async function syncLinkedInConnectedInboxes(limit = 10) {
  const rows = await prisma.linkedInConnection.findMany({
    where: { status: "CONNECTED", stoppedAt: null },
    orderBy: { lastCheckedAt: "asc" },
    take: limit,
    select: { leadId: true },
  });
  const out = { checked: 0, ingested: 0 };
  for (const row of rows) {
    out.checked += 1;
    const result = await syncLinkedInInboxForLead(row.leadId).catch(() => null);
    if (result?.ingested) out.ingested += 1;
  }
  return out;
}
