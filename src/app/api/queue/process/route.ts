import { NextResponse } from "next/server";

import { authenticateHttp, withQueueSecret, workerPrincipal } from "@/lib/auth/http";
import { principalStorage } from "@/lib/auth/context";
import { isQueueRequestAuthorized } from "@/lib/queue/auth";
import { prisma } from "@/lib/db/prisma";
import { processQueue } from "@/lib/queue/engine";
import { pollGmailReplies, tickDueSequenceSteps } from "@/lib/outreach/engine";
import { runLinkedInDailyOutreachWorker } from "@/lib/linkedin/daily/worker";
import { runTwitterDailyOutreachWorker } from "@/lib/twitter/daily/worker";

export async function queueStatus() {
  const [queued, running, retrying] = await Promise.all([
    prisma.task.count({ where: { status: "QUEUED" } }),
    prisma.task.count({ where: { status: "RUNNING" } }),
    prisma.task.count({ where: { status: "RETRYING" } }),
  ]);
  return { ok: true, processed: false, queued, running, retrying };
}

/** Status only. This method must not claim work or send. */
export async function GET(request: Request) {
  if (!isQueueRequestAuthorized(request)) {
    const user = await authenticateHttp(request);
    if (!user.ok) return NextResponse.json(user.body, { status: user.status });
    const status = await principalStorage.run(user.principal, () => queueStatus());
    return NextResponse.json(status);
  }
  const status = await principalStorage.run(workerPrincipal(), () => queueStatus());
  return NextResponse.json(status);
}

export const POST = withQueueSecret(async () => {
  const results = await processQueue(8);
  const actorRuns = await import("@/lib/campaigns/runner")
    .then((mod) => mod.syncOpenActorRuns())
    .catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
  const sequences = await tickDueSequenceSteps();
  const replies = process.env.GMAIL_REPLY_POLL === "true" ? await pollGmailReplies() : { replies: 0, bounces: 0, stopped: 0, escalated: 0, skipped: "GMAIL_REPLY_POLL is not true" };
  const linkedinDaily =
    process.env.ENABLE_SOCIAL_AUTOMATION === "true"
      ? await runLinkedInDailyOutreachWorker().catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      : { ok: false, skipped: "Social automation is off." };
  const twitterDaily =
    process.env.ENABLE_SOCIAL_AUTOMATION === "true"
      ? await runTwitterDailyOutreachWorker().catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      : { ok: false, skipped: "Social automation is off." };
  return NextResponse.json({
    processed: results.length,
    results,
    sequences,
    replies,
    linkedinDaily,
    twitterDaily,
    actorRuns,
  });
});
