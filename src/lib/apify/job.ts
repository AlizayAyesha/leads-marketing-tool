import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { applyResultCap, testModeBlockedBySchema } from "@/lib/apify/ids";
import { ApifyService } from "@/lib/apify/service";
import { runActor, type ApifyRunClient } from "@/lib/apify/tool";
import { collectKeys, guessMapping, mapActorItem, type OutputMapping } from "@/lib/actors/mapping";
import { ingestLeads } from "@/lib/leads/ingest";
import { apifySourceRef, wrapApifyRecord } from "@/lib/apify/lineage";
import { getApifyToken } from "@/lib/secrets";
import { writeAudit } from "@/lib/db/settings";

const TEST_LIMIT = 5;

export type ActorJobReport = {
  actorName: string;
  actorId: string;
  status: "SUCCEEDED" | "FAILED" | "RUNNING" | "ABORTED" | "TIMED_OUT";
  runId: string | null;
  datasetId: string | null;
  items: number;
  preview: unknown[];
  leadsCreated: number;
  duplicates: number;
  sent: 0;
  error: string | null;
  actorRunRowId: string | null;
};

async function liveApifyClient(): Promise<ApifyRunClient> {
  const token = await getApifyToken();
  const service = new ApifyService();
  return {
    configured: Boolean(token.token),
    startRun: (input) => service.startRun(input),
    getDatasetItems: (datasetId, limit) => service.getDatasetItems(datasetId, limit),
  };
}

function asRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function failedReport(actorName: string, actorId: string, error: string): ActorJobReport {
  return {
    actorName,
    actorId,
    status: "FAILED",
    runId: null,
    datasetId: null,
    items: 0,
    preview: [],
    leadsCreated: 0,
    duplicates: 0,
    sent: 0,
    error,
    actorRunRowId: null,
  };
}

export async function runConfiguredActorJob(input: {
  apifyActorId: string;
  testMode?: boolean;
  ingest?: boolean;
  pipeline?: boolean;
  limit?: number;
  inputOverride?: Record<string, unknown>;
}): Promise<ActorJobReport> {
  const actor = await prisma.apifyActor.findUnique({ where: { id: input.apifyActorId } });
  if (!actor) return failedReport("unknown", input.apifyActorId, "Actor not found");
  if (!actor.active) return failedReport(actor.displayName, actor.actorId, "Actor is disabled.");

  const testMode = input.testMode !== false;
  const cap = testMode ? TEST_LIMIT : input.limit ?? 500;
  const schema = asRecord(actor.inputSchema);
  const runInput = applyResultCap({ ...asRecord(actor.inputValues), ...(input.inputOverride ?? {}) }, schema, testMode);
  const blocked = testMode ? testModeBlockedBySchema(schema) : null;
  const client = await liveApifyClient();

  const row = await prisma.actorRun.create({
    data: {
      apifyActorId: actor.id,
      status: "STARTING",
      testMode,
      input: runInput as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
  });
  await prisma.apifyActor.update({
    where: { id: actor.id },
    data: { lastRunAt: new Date(), totalRuns: { increment: 1 } },
  });

  if (blocked) {
    await prisma.actorRun.update({
      where: { id: row.id },
      data: { status: "FAILED", error: blocked, completedAt: new Date() },
    });
    await prisma.apifyActor.update({
      where: { id: actor.id },
      data: { errorCount: { increment: 1 } },
    });
    return {
      actorName: actor.displayName,
      actorId: actor.actorId,
      status: "FAILED",
      runId: null,
      datasetId: null,
      items: 0,
      preview: [],
      leadsCreated: 0,
      duplicates: 0,
      sent: 0,
      actorRunRowId: row.id,
      error: blocked,
    };
  }

  const result = await runActor(
    { actorId: actor.actorId, runInput, testMode, itemLimit: cap },
    client,
  );

  await prisma.actorRun.update({
    where: { id: row.id },
    data: {
      externalRunId: result.runId,
      datasetId: result.datasetId,
      status: result.status,
      error: result.error,
      resultCount: result.itemCount,
      completedAt: result.status === "RUNNING" ? null : new Date(),
    },
  });

  let leadsCreated = 0;
  let duplicates = 0;
  let storedIds: string[] = [];
  if (result.status === "SUCCEEDED" && input.ingest !== false && result.items.length) {
    const ingested = await ingestActorItems({
      actor,
      items: result.items,
      runId: result.runId,
      datasetId: result.datasetId,
    });
    leadsCreated = ingested.stored;
    duplicates = ingested.duplicates;
    storedIds = ingested.storedIds;
    await prisma.actorRun.update({
      where: { id: row.id },
      data: { ingestedNew: ingested.stored },
    });
    await prisma.apifyActor.update({
      where: { id: actor.id },
      data: { lastSuccessAt: new Date(), leadsGenerated: { increment: ingested.stored } },
    });
  } else if (result.status === "FAILED") {
    await prisma.apifyActor.update({
      where: { id: actor.id },
      data: { errorCount: { increment: 1 } },
    });
  }

  if (input.pipeline && storedIds.length) {
    const { enqueue, processQueue } = await import("@/lib/queue/engine");
    for (const leadId of storedIds.slice(0, testMode ? TEST_LIMIT : 25)) {
      await enqueue({ type: "PIPELINE_LEAD", leadId });
    }
    await processQueue(3);
  }

  await writeAudit({
    action: testMode ? "apify.test_actor" : "apify.run_actor",
    entity: "actor_run",
    entityId: row.id,
    payload: {
      actorId: actor.actorId,
      status: result.status,
      items: result.itemCount,
      leadsCreated,
      sent: 0,
    },
  });

  return {
    actorName: actor.displayName,
    actorId: actor.actorId,
    status: result.status,
    runId: result.runId,
    datasetId: result.datasetId,
    items: result.itemCount,
    preview: result.items.slice(0, 5),
    leadsCreated,
    duplicates,
    sent: 0,
    actorRunRowId: row.id,
    error: result.error,
  };
}

export async function runConfiguredActorsJob(input: {
  actorIds?: string[];
  actorQuery?: string | null;
  testMode?: boolean;
  ingest?: boolean;
  pipeline?: boolean;
  limit?: number;
}) {
  const where = input.actorIds?.length
    ? { id: { in: input.actorIds }, active: true }
    : { active: true };
  let actors = await prisma.apifyActor.findMany({ where, orderBy: { createdAt: "asc" } });
  if (input.actorQuery) {
    const q = input.actorQuery.toLowerCase();
    const matched = actors.filter(
      (actor) =>
        actor.displayName.toLowerCase().includes(q) ||
        actor.actorId.toLowerCase().includes(q) ||
        (actor.category ?? "").toLowerCase().includes(q) ||
        (actor.platform ?? "").toLowerCase().includes(q),
    );
    actors = matched;
  }
  if (actors.length === 0) {
    return {
      successful: 0,
      failed: 0,
      reports: [] as ActorJobReport[],
      sent: 0 as const,
      leadIds: [] as string[],
      note: input.actorQuery
        ? `No enabled Apify Actor matches “${input.actorQuery}”. Check the actor name/ID in Integrations → Apify.`
        : "No enabled Apify Actors are registered. Add and configure an actor in Integrations → Apify.",
    };
  }

  const settled = await Promise.allSettled(
    actors.map((actor) =>
      runConfiguredActorJob({
        apifyActorId: actor.id,
        testMode: input.testMode,
        ingest: input.ingest,
        pipeline: false,
        limit: input.limit,
      }),
    ),
  );

  const reports = settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    return failedReport(
      actors[index].displayName,
      actors[index].actorId,
      item.reason instanceof Error ? item.reason.message : "Actor failed.",
    );
  });

  const storedIds: string[] = [];
  if (input.pipeline) {
    const { enqueue, processQueue } = await import("@/lib/queue/engine");
    const newest = await prisma.lead.findMany({
      where: { source: { startsWith: "apify:" }, status: "NEW" },
      orderBy: { createdAt: "desc" },
      take: input.testMode === false ? 25 : TEST_LIMIT,
    });
    for (const lead of newest) {
      await enqueue({ type: "PIPELINE_LEAD", leadId: lead.id });
      storedIds.push(lead.leadId);
    }
    if (newest.length) await processQueue(3);
  }

  return {
    successful: reports.filter((item) => item.status === "SUCCEEDED").length,
    failed: reports.filter((item) => item.status === "FAILED").length,
    reports,
    sent: 0 as const,
    leadIds: storedIds,
    note: `${reports.filter((item) => item.status === "SUCCEEDED").length} successful, ${reports.filter((item) => item.status === "FAILED").length} failed. External messages sent: 0.`,
  };
}

export async function ingestActorItems(input: {
  actor: { id: string; actorId: string; displayName: string; outputMapping: Prisma.JsonValue };
  items: unknown[];
  runId: string | null;
  datasetId: string | null;
  campaignId?: string | null;
}) {
  const storedMapping = (input.actor.outputMapping ?? {}) as OutputMapping;
  const mapping = Object.values(storedMapping).some(Boolean)
    ? storedMapping
    : guessMapping(collectKeys(input.items));
  const ref = apifySourceRef({
    actorId: input.actor.actorId,
    runId: input.runId,
    datasetId: input.datasetId,
  });
  const leads = input.items.map((item) => {
    const mapped = mapActorItem(item, mapping, {
      source: `apify:${input.actor.actorId}`,
      sourceActor: input.actor.actorId,
    });
    return {
      ...mapped,
      rawPayload: wrapApifyRecord(item, ref),
      sourceRunId: input.runId,
      sourceDatasetId: input.datasetId,
      sourceRef: ref,
    };
  });
  return ingestLeads({
    leads,
    sourceName: `apify:${input.actor.displayName}`,
    campaignId: input.campaignId ?? null,
  });
}
