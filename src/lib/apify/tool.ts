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
};

export async function runActor(
  input: {
    actorId: string;
    runInput?: Record<string, unknown>;
    testMode?: boolean;
    itemLimit?: number;
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
    const run = await client.startRun({
      actorId,
      runInput: input.runInput ?? {},
      testMode: input.testMode,
      waitForFinishSec: input.testMode ? 55 : 0,
    });
    const status = mapApifyStatus(run.status);
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
      error: fetchError ? redactSecrets(fetchError) : run.statusMessage,
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
