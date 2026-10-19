import "server-only";

import { productionLeadWhere } from "@/lib/analytics/production";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { importFromConfiguredSheet } from "@/lib/google/sync";
import { OLD_SCRAPE_DONE_MESSAGE } from "@/lib/google/sheet-batch";
import { markSheetBatchUsed } from "@/lib/google/sheet-batch-store";
import { listLinkedInLeadBlockers } from "@/lib/linkedin/connection/blockers";
import { listLinkedInProspectQueue } from "@/lib/linkedin/connection/queue";
import { isChromeLinkedInSessionReady } from "@/lib/linkedin/session/host";
import { runOutreachEngine } from "@/lib/outreach/engine";
import { getOutreachEnginePolicy, assumeOutreachControl } from "@/lib/outreach/sequence";
import { runLeadPipeline } from "@/lib/pipeline/run";
import { getChromeSession } from "@/lib/tools/chrome";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";

/**
 * Prepare-only: sheet import + research pipeline + draft engine.
 * Does NOT send LinkedIn or X — those stay on Home channel buttons
 * (`runHomeChannelAction`) so there is one live-send door per channel.
 */
export type LiveOutreachReport = {
  ok: boolean;
  needNewScrape?: boolean;
  policy: {
    sendsPaused: boolean;
    sendMode: string;
    linkedinDailyOutreach: boolean;
  };
  import: Awaited<ReturnType<typeof importFromConfiguredSheet>>;
  pipeline: { scanned: number; errors: string[] };
  engine: Awaited<ReturnType<typeof runOutreachEngine>>;
  linkedinPreview: {
    connectionCandidates: number;
    messageCandidates: number;
    topConnections: Array<{ leadId: string; name: string | null; rankScore: number; reasons: string[] }>;
  };
  /** Preview / readiness only — no worker send from this path. */
  linkedinDaily: { ok: false; error: string; skippedSend: true };
  chrome: { status: string; linkedinReady: boolean };
  blockers: Awaited<ReturnType<typeof listLinkedInLeadBlockers>>;
  blockedSummary: string[];
};

export async function runLiveOutreach(input: {
  pipelineLimit?: number;
  engineLimit?: number;
  importSheet?: boolean;
  enableLivePolicy?: boolean;
  reuseSheet?: boolean;
} = {}): Promise<LiveOutreachReport> {
  const pipelineLimit = Math.min(Math.max(input.pipelineLimit ?? 10, 1), 40);
  const engineLimit = Math.min(Math.max(input.engineLimit ?? 10, 1), 30);
  const blockedSummary: string[] = [];

  const imported =
    input.importSheet === false
      ? {
          pending: false,
          exhausted: false,
          message: "Sheet import skipped.",
          sourceOfTruth: "postgresql" as const,
          workspace: "google-sheets" as const,
        }
      : await importFromConfiguredSheet({ limit: 50, reuseSheet: input.reuseSheet }).catch((error) => ({
          pending: true,
          exhausted: false,
          message: error instanceof Error ? error.message : "Sheet import failed.",
          sourceOfTruth: "postgresql" as const,
          workspace: "google-sheets" as const,
        }));

  if ("exhausted" in imported && imported.exhausted) {
    const policy = await getOutreachEnginePolicy();
    const chrome = getChromeSession();
    return {
      ok: false,
      needNewScrape: true,
      policy: {
        sendsPaused: policy.sendsPaused,
        sendMode: policy.sendMode,
        linkedinDailyOutreach: policy.linkedinDailyOutreach,
      },
      import: imported,
      pipeline: { scanned: 0, errors: [] },
      engine: {
        imported: false,
        scanned: 0,
        passed: 0,
        held: 0,
        rejected: 0,
        enrolled: 0,
        drafts: 0,
        sent: 0,
        replies: 0,
        stopped: 0,
        escalated: 0,
        blocked: [OLD_SCRAPE_DONE_MESSAGE],
        leadIds: [],
      },
      linkedinPreview: { connectionCandidates: 0, messageCandidates: 0, topConnections: [] },
      linkedinDaily: {
        ok: false,
        error: OLD_SCRAPE_DONE_MESSAGE,
        skippedSend: true,
      },
      chrome: { status: chrome.status, linkedinReady: isChromeLinkedInSessionReady() },
      blockers: [],
      blockedSummary: [OLD_SCRAPE_DONE_MESSAGE],
    };
  }

  let policy = await getOutreachEnginePolicy();
  if (input.enableLivePolicy !== false) {
    policy = await assumeOutreachControl();
    await writeAudit({
      action: "outreach.live.prepare",
      entity: "setting",
      payload: {
        sendsPaused: policy.sendsPaused,
        sendMode: policy.sendMode,
        linkedinDailyOutreach: true,
        twitterDailyOutreach: true,
        prepareOnly: true,
      },
    });
  }

  const pipelineErrors: string[] = [];
  const existingSendable = await listLinkedInProspectQueue(new Date(), "send");
  const alreadyReady = new Set(existingSendable.connections.map((row) => row.id));

  const pipelineLeads = await prisma.lead.findMany({
    where: {
      AND: [productionLeadWhere()],
      suppressed: false,
      OR: [{ linkedinUrl: { not: null } }, { email: { not: null } }],
    },
    orderBy: { lastActivityAt: "desc" },
    take: Math.max(pipelineLimit * 3, 20),
    select: { id: true, leadId: true, linkedinUrl: true, email: true },
  });

  // Prefer person LinkedIn profiles that are not already send-ready.
  const prioritized = [...pipelineLeads]
    .filter((lead) => !alreadyReady.has(lead.id))
    .sort((a, b) => {
      const aPerson = inspectLinkedInUrl(a.linkedinUrl).kind === "person" ? 0 : 1;
      const bPerson = inspectLinkedInUrl(b.linkedinUrl).kind === "person" ? 0 : 1;
      if (aPerson !== bPerson) return aPerson - bPerson;
      return 0;
    })
    .slice(0, alreadyReady.size > 0 ? Math.min(pipelineLimit, 3) : pipelineLimit);

  for (const lead of prioritized) {
    try {
      await runLeadPipeline(lead.id, { engine: true });
    } catch (error) {
      pipelineErrors.push(`${lead.leadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const engine = await runOutreachEngine({
    limit: engineLimit,
    importSheet: false,
    command: "Prepare outreach. Draft email for PASS leads; do not start LinkedIn or X send.",
  });

  const preview = await listLinkedInProspectQueue(new Date(), "send");
  const chrome = getChromeSession();
  const linkedinReady = isChromeLinkedInSessionReady();

  const readyHint =
    preview.connections.length > 0
      ? `${preview.connections.length} LinkedIn connection prospect(s) ready. Send from Home → LinkedIn · connections.`
      : "No LinkedIn connection prospects ready yet. Check buyer filter / person URL / research on Home.";
  const linkedinDaily: LiveOutreachReport["linkedinDaily"] = {
    ok: false,
    error: readyHint,
    skippedSend: true,
  };
  blockedSummary.push(
    "Prepare only — LinkedIn and X were not sent. Use Home channel buttons to send.",
  );
  if (!linkedinReady) {
    blockedSummary.push(
      "Jarvis Chrome LinkedIn is not signed in. Sign in from Home before LinkedIn send.",
    );
  }

  await import("@/lib/outreach/engine")
    .then((mod) => mod.tickDueSequenceSteps())
    .catch(() => null);
  const { enqueue } = await import("@/lib/queue/engine");
  await enqueue({ type: "PROCESS_SEQUENCES" }).catch(() => null);
  await enqueue({ type: "RUN_OUTREACH_ENGINE", payload: { limit: engineLimit } }).catch(() => null);

  const blockers = await listLinkedInLeadBlockers(20);
  if (engine.blocked.length) blockedSummary.push(...engine.blocked.slice(0, 8));
  for (const row of blockers.filter((item) => !item.sendable).slice(0, 8)) {
    blockedSummary.push(`${row.leadId}: ${row.code} — ${row.reason}`);
  }

  if (input.importSheet !== false && !("pending" in imported && imported.pending)) {
    await markSheetBatchUsed();
  }

  return {
    ok: engine.drafts > 0 || engine.sent > 0 || preview.connections.length > 0 || prioritized.length > 0,
    policy: {
      sendsPaused: policy.sendsPaused,
      sendMode: policy.sendMode,
      linkedinDailyOutreach: policy.linkedinDailyOutreach,
    },
    import: imported,
    pipeline: { scanned: prioritized.length, errors: pipelineErrors },
    engine,
    linkedinPreview: {
      connectionCandidates: preview.connections.length,
      messageCandidates: preview.messages.length,
      topConnections: preview.connections.slice(0, 5).map((row) => ({
        leadId: row.leadId,
        name: row.name,
        rankScore: row.rankScore,
        reasons: row.reasons,
      })),
    },
    linkedinDaily,
    chrome: { status: chrome.status, linkedinReady },
    blockers,
    blockedSummary,
  };
}
