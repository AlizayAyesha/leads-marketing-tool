import { NextResponse } from "next/server";

import { SOCIAL_AUTOMATION_DISABLED_REASON, socialAutomationEnabled } from "@/lib/features";

import { listLinkedInLeadBlockers } from "@/lib/linkedin/connection/blockers";
import { listLinkedInProspectQueue } from "@/lib/linkedin/connection/queue";
import { runLinkedInDailyOutreachWorker } from "@/lib/linkedin/daily/worker";
import { isChromeLinkedInSessionReady } from "@/lib/linkedin/session/host";
import { getOutreachEnginePolicy, saveOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { getChromeSession } from "@/lib/tools/chrome";
import { writeAudit } from "@/lib/db/settings";

/**
 * LinkedIn-only live send. Does not re-run the full research pipeline.
 * Requires Jarvis Chrome connected with LinkedIn signed in.
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
      linkedinDailyOutreach: true,
      linkedinDrafts: true,
    });
    await writeAudit({
      action: "outreach.linkedin.send_now",
      entity: "setting",
      payload: { linkedinDailyOutreach: true, sendsPaused: policy.sendsPaused },
    });

    const chrome = getChromeSession();
    const linkedinReady = isChromeLinkedInSessionReady();
    const preview = await listLinkedInProspectQueue(new Date(), "send");
    const blockers = await listLinkedInLeadBlockers(20);

    if (!linkedinReady) {
      return NextResponse.json({
        ok: false,
        policy: {
          sendsPaused: policy.sendsPaused,
          linkedinDailyOutreach: policy.linkedinDailyOutreach,
        },
        chrome: { status: chrome.status, linkedinReady },
        linkedinPreview: {
          connectionCandidates: preview.connections.length,
          topConnections: preview.connections.slice(0, 5),
        },
        blockers,
        error: "Jarvis Chrome LinkedIn session is not connected. Connect from Home and sign into LinkedIn.",
      });
    }

    if (preview.connections.length === 0) {
      return NextResponse.json({
        ok: false,
        policy: {
          sendsPaused: policy.sendsPaused,
          linkedinDailyOutreach: policy.linkedinDailyOutreach,
        },
        chrome: { status: chrome.status, linkedinReady },
        linkedinPreview: { connectionCandidates: 0, topConnections: [] },
        blockers,
        error: "No sendable LinkedIn prospects. See blockers for Decision Maker / research gaps.",
      });
    }

    const linkedinDaily = await runLinkedInDailyOutreachWorker();
    return NextResponse.json({
      ok: true,
      policy: {
        sendsPaused: policy.sendsPaused,
        linkedinDailyOutreach: policy.linkedinDailyOutreach,
      },
      chrome: { status: chrome.status, linkedinReady },
      linkedinPreview: {
        connectionCandidates: preview.connections.length,
        topConnections: preview.connections.slice(0, 5),
      },
      linkedinDaily,
      blockers,
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
    { ok: false, error: "Use POST. GET cannot start LinkedIn outreach." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
