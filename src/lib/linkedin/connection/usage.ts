import "server-only";

import { prisma } from "@/lib/db/prisma";
import { LINKEDIN_CONNECT_STEP, LINKEDIN_POST_CONNECTION_STEP } from "@/lib/linkedin/connection/types";
import { linkedInDailyQuota, type LinkedInDailyQuota } from "@/lib/linkedin/connection/quota";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { startOfLinkedInLocalDay } from "@/lib/linkedin/daily/authorize";
import { LINKEDIN_CONNECTION_SENT_EVENT, LINKEDIN_MESSAGE_SENT_EVENT } from "@/lib/linkedin/daily/events";

function startOfLocalDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function countLinkedInDailyUsage(now = new Date()): Promise<LinkedInDailyQuota> {
  const start = startOfLocalDay(now);
  const policy = await getOutreachEnginePolicy();
  const [connectionsToday, messagesToday] = await Promise.all([
    prisma.outreachDraft.count({
      where: {
        channel: "LINKEDIN",
        stepKind: LINKEDIN_CONNECT_STEP,
        createdAt: { gte: start },
        NOT: { status: { in: ["REJECTED", "SUPERSEDED"] } },
      },
    }),
    prisma.outreachDraft.count({
      where: {
        channel: "LINKEDIN",
        stepKind: LINKEDIN_POST_CONNECTION_STEP,
        createdAt: { gte: start },
        NOT: { status: { in: ["REJECTED", "SUPERSEDED"] } },
      },
    }),
  ]);
  return linkedInDailyQuota({
    connectionsToday,
    messagesToday,
    connectionCap: policy.linkedinConnectionDailyCap,
    messageCap: policy.linkedinMessageDailyCap,
  });
}


export async function countLinkedInConfirmedSends(now = new Date()) {
  const start = startOfLinkedInLocalDay(now);
  const policy = await getOutreachEnginePolicy();
  const [connectionsToday, messagesToday] = await Promise.all([
    prisma.outreachEvent.count({
      where: { channel: "LINKEDIN", type: LINKEDIN_CONNECTION_SENT_EVENT, createdAt: { gte: start } },
    }),
    prisma.outreachEvent.count({
      where: { channel: "LINKEDIN", type: LINKEDIN_MESSAGE_SENT_EVENT, createdAt: { gte: start } },
    }),
  ]);
  return linkedInDailyQuota({
    connectionsToday,
    messagesToday,
    connectionCap: policy.linkedinConnectionDailyCap,
    messageCap: policy.linkedinMessageDailyCap,
  });
}

export async function loadLinkedInDailyAttemptedKeys(now = new Date()) {
  const start = startOfLinkedInLocalDay(now);
  const rows = await prisma.outreachEvent.findMany({
    where: {
      channel: "LINKEDIN",
      type: { in: [LINKEDIN_CONNECTION_SENT_EVENT, LINKEDIN_MESSAGE_SENT_EVENT] },
      createdAt: { gte: start },
    },
    select: { payload: true },
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const payload = row.payload && typeof row.payload === "object" ? (row.payload as { idempotencyKey?: string }) : {};
    if (payload.idempotencyKey) keys.add(payload.idempotencyKey);
  }
  return keys;
}
