import { encodeActorId, mapApifyStatus, type ApifyRunInfo } from "@/lib/apify/ids";
import { redactSecrets } from "@/lib/apify/redact";

export type ApifyActorRunResult = {
  runId: string | null;
  actorId: string;
  status: "SUCCEEDED" | "FAILED" | "RUNNING" | "ABORTED" | "TIMED_OUT";
  datasetId: string | null;
  itemCount: number;
  items: unknown[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  sent: 0;
};

export type ApifyRunClient = {
  configured: boolean;
  startRun(input: {
    actorId: string;
    runInput: Record<string, unknown>;
    testMode?: boolean;
    waitForFinishSec?: number;
  }): Promise<ApifyRunInfo>;
  getDatasetItems(datasetId: string, limit: number): Promise<unknown[]>;
  /** Present on the live client so a non-test run can be polled until it finishes. */
  getRun?(runId: string): Promise<ApifyRunInfo>;
};

const FULL_RUN_POLL_MS = 150_000;
const FULL_RUN_POLL_INTERVAL_MS = 4_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runActor(
  input: {
    actorId: string;
    runInput?: Record<string, unknown>;
    testMode?: boolean;
    itemLimit?: number;
    /** How long to poll a still-running actor. Defaults to 150s for non-test runs when getRun exists. */
    pollForMs?: number;
  },
  client: ApifyRunClient,
): Promise<ApifyActorRunResult> {
  const actorId = input.actorId.trim();
  if (!client.configured) {
    return failed(actorId, "Apify is not connected. Set APIFY_TOKEN or save a token in Integrations → API Keys.");
  }
  try {
    encodeActorId(actorId);
  } catch (error) {
    return failed(actorId, error instanceof Error ? error.message : "Invalid actor ID.");
  }

  try {
    let run = await client.startRun({
      actorId,
      runInput: input.runInput ?? {},
      testMode: input.testMode,
      waitForFinishSec: input.testMode ? 55 : 0,
    });
    let status = mapApifyStatus(run.status);
    const pollForMs = input.pollForMs ?? (input.testMode === false && client.getRun ? FULL_RUN_POLL_MS : 0);
    if (status === "RUNNING" && pollForMs > 0 && client.getRun && run.id) {
      const getRun = client.getRun;
      const deadline = Date.now() + pollForMs;
      while (status === "RUNNING" && Date.now() <= deadline) {
        try {
          const snap = await getRun(run.id);
          run = snap;
          status = mapApifyStatus(snap.status);
        } catch {
          break;
        }
        if (status !== "RUNNING") break;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await delay(Math.min(FULL_RUN_POLL_INTERVAL_MS, remaining));
      }
    }
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED_OUT") {
      return {
        runId: run.id || null,
        actorId,
        status,
        datasetId: run.defaultDatasetId,
        itemCount: 0,
        items: [],
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: redactSecrets(run.statusMessage || `${status}: Actor run did not succeed.`),
        sent: 0,
      };
    }

    const limit = input.itemLimit ?? (input.testMode ? 5 : 500);
    let items: unknown[] = [];
    let fetchError: string | null = null;
    if (run.defaultDatasetId && status === "SUCCEEDED") {
      try {
        items = await client.getDatasetItems(run.defaultDatasetId, limit);
      } catch (error) {
        fetchError = error instanceof Error ? error.message : "Failed to read Actor dataset.";
      }
    }

    return {
      runId: run.id || null,
      actorId,
      status,
      datasetId: run.defaultDatasetId,
      itemCount: items.length,
      items,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      // Apify sets statusMessage on success ("Scraping finished…"). That is not a failure.
      error:
        status === "SUCCEEDED"
          ? fetchError
            ? redactSecrets(fetchError)
            : null
          : status === "RUNNING"
            ? null
            : redactSecrets(run.statusMessage || `${status}: Actor run did not succeed.`),
      sent: 0,
    };
  } catch (error) {
    return failed(actorId, error instanceof Error ? error.message : "Actor failed.");
  }
}

function failed(actorId: string, error: string): ApifyActorRunResult {
  return {
    runId: null,
    actorId,
    status: "FAILED",
    datasetId: null,
    itemCount: 0,
    items: [],
    startedAt: null,
    finishedAt: null,
    error: redactSecrets(error),
    sent: 0,
  };
}

export async function runActorsIsolated(
  actorIds: string[],
  runOne: (actorId: string) => Promise<ApifyActorRunResult>,
) {
  const settled = await Promise.allSettled(actorIds.map((id) => runOne(id)));
  const results = settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    return failed(
      actorIds[index],
      item.reason instanceof Error ? item.reason.message : "Actor failed.",
    );
  });
  return {
    actors: results,
    successful: results.filter((item) => item.status === "SUCCEEDED").length,
    failed: results.filter((item) => item.status === "FAILED").length,
    itemCount: results.reduce((sum, item) => sum + item.itemCount, 0),
    sent: 0 as const,
  };
}
