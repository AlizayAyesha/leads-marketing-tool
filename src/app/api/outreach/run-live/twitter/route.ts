import { NextResponse } from "next/server";

import { SOCIAL_AUTOMATION_DISABLED_REASON, socialAutomationEnabled } from "@/lib/features";

import { writeAudit } from "@/lib/db/settings";
import { getOutreachEnginePolicy, saveOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { loadTwitterDailyCandidates } from "@/lib/twitter/daily/queue";
import { runTwitterDailyOutreachWorker } from "@/lib/twitter/daily/worker";
import { isChromeTwitterSessionReady } from "@/lib/twitter/session/host";
import { getChromeSession } from "@/lib/tools/chrome";

/**
 * X-only live DM send via Jarvis Chrome. Does not re-run the full research pipeline.
 * Requires Jarvis Chrome connected with x.com signed in.
 */
export async function POST() {
  if (!socialAutomationEnabled()) {
    return NextResponse.json({ ok: false, error: SOCIAL_AUTOMATION_DISABLED_REASON }, { status: 403 });
  }
  try {
    let policy = await getOutreachEnginePolicy();
    policy = await saveOutreachEnginePolicy({
      ...policy,
      enabled: true,
      twitterDailyOutreach: true,
      twitterDrafts: true,
    });
    await writeAudit({
      action: "outreach.twitter.send_now",
      entity: "setting",
      payload: { twitterDailyOutreach: true, sendsPaused: policy.sendsPaused },
    });

    const chrome = getChromeSession();
    const twitterReady = isChromeTwitterSessionReady();
    const candidates = await loadTwitterDailyCandidates(new Date(), 10);

    if (!twitterReady) {
      return NextResponse.json({
        ok: false,
        policy: {
          sendsPaused: policy.sendsPaused,
          twitterDailyOutreach: policy.twitterDailyOutreach,
        },
        chrome: { status: chrome.status, twitterReady },
        twitterPreview: { candidates: candidates.length, top: candidates.slice(0, 5) },
        error: "Jarvis Chrome is not connected. Connect from Home and sign into x.com in that window.",
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: false,
        policy: {
          sendsPaused: policy.sendsPaused,
          twitterDailyOutreach: policy.twitterDailyOutreach,
        },
        chrome: { status: chrome.status, twitterReady },
        twitterPreview: { candidates: 0, top: [] },
        error: "No PASS X leads with a person twitterUrl ready to DM.",
      });
    }

    const twitterDaily = await runTwitterDailyOutreachWorker();
    return NextResponse.json({
      ok: true,
      policy: {
        sendsPaused: policy.sendsPaused,
        twitterDailyOutreach: policy.twitterDailyOutreach,
      },
      chrome: { status: chrome.status, twitterReady },
      twitterPreview: {
        candidates: candidates.length,
        top: candidates.slice(0, 5).map((c) => ({
          leadId: c.leadId,
          name: c.name,
          twitterUrl: c.twitterUrl,
        })),
      },
      twitterDaily,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST. GET cannot start X outreach." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
