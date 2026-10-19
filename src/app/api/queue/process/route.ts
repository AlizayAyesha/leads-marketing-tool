import { NextResponse } from "next/server";

import { isQueueRequestAuthorized } from "@/lib/queue/auth";
import { processQueue } from "@/lib/queue/engine";
import { pollGmailReplies, tickDueSequenceSteps } from "@/lib/outreach/engine";
import { runLinkedInDailyOutreachWorker } from "@/lib/linkedin/daily/worker";
import { runTwitterDailyOutreachWorker } from "@/lib/twitter/daily/worker";

export async function POST(request: Request) {
  if (!isQueueRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await processQueue(8);
  const actorRuns = await import("@/lib/campaigns/runner")
    .then((mod) => mod.syncOpenActorRuns())
    .catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
  const sequences = await tickDueSequenceSteps();
  const replies = await pollGmailReplies();
  const linkedinDaily = await runLinkedInDailyOutreachWorker().catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  const twitterDaily = await runTwitterDailyOutreachWorker().catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  return NextResponse.json({
    processed: results.length,
    results,
    sequences,
    replies,
    linkedinDaily,
    twitterDaily,
    actorRuns,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
