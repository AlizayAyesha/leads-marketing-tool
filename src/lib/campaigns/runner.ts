import "server-only";

import type { Prisma, ScraperRunStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getActorProvider } from "@/lib/actors/registry";
import { applyResultCap, testModeBlockedBySchema } from "@/lib/apify/service";
import { ingestActorItems } from "@/lib/apify/job";
import { exportEnrichedRows } from "@/lib/data-sources/google";
import { IntegrationPendingError } from "@/lib/data-sources/types";
import { enqueue, processQueue } from "@/lib/queue/engine";
import { writeAudit } from "@/lib/db/settings";

const TEST_LIMIT = 5;
const FULL_LIMIT = 500;

export async function startCampaignRun(campaignId: string, testMode = false) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      actors: { where: { enabled: true }, include: { actor: true } },
    },
  });
  if (!campaign) throw new Error("Campaign not found");
  const selected = campaign.actors.filter((item) => item.actor.active);
  if (selected.length === 0) throw new Error("Select at least one active actor.");
  if (selected.length > 8) throw new Error("A campaign can run at most 8 actors.");

  const run = await prisma.campaignRun.create({
    data: {
      campaignId,
      status: "RUNNING",
      testMode,
      startedAt: new Date(),
    },
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "ACTIVE" },
  });

  await Promise.allSettled(
    selected.map((item) =>
      startActorForCampaign({
        campaignRunId: run.id,
        actor: item.actor,
        inputOverride: (item.inputOverride ?? {}) as Record<string, unknown>,
        testMode,
      }),
    ),
  );

  await writeAudit({
    action: "campaign.start",
    entity: "campaign_run",
    entityId: run.id,
    payload: { campaignId, testMode, actors: selected.length },
  });

  return run;
}

export async function startStandaloneActorRun(apifyActorId: string, testMode = true) {
  const actor = await prisma.apifyActor.findUnique({ where: { id: apifyActorId } });
  if (!actor) throw new Error("Actor not found");
  if (!actor.active) throw new Error("Actor is disabled.");
  return startActorForCampaign({
    campaignRunId: null,
    actor,
    inputOverride: {},
    testMode,
  });
}

async function startActorForCampaign(input: {
  campaignRunId: string | null;
  actor: {
    id: string;
    actorId: string;
    inputSchema: Prisma.JsonValue;
    inputValues: Prisma.JsonValue;
  };
  inputOverride: Record<string, unknown>;
  testMode: boolean;
}) {
  const defaults = asRecord(input.actor.inputValues);
  const schema = asRecord(input.actor.inputSchema);
  const merged = applyResultCap(
    { ...defaults, ...input.inputOverride },
    schema,
    input.testMode,
  );
  const blocked = input.testMode ? testModeBlockedBySchema(schema) : null;

  const row = await prisma.actorRun.create({
    data: {
      apifyActorId: input.actor.id,
      campaignRunId: input.campaignRunId,
      status: "STARTING",
      testMode: input.testMode,
      input: merged as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
  });

  await prisma.apifyActor.update({
    where: { id: input.actor.id },
    data: { lastRunAt: new Date(), totalRuns: { increment: 1 } },
  });

  if (blocked) {
    await prisma.actorRun.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        error: blocked,
        errorCount: 1,
        completedAt: new Date(),
      },
    });
    await prisma.apifyActor.update({
      where: { id: input.actor.id },
      data: { errorCount: { increment: 1 } },
    });
    return row.id;
  }

  try {
    const provider = getActorProvider("apify");
    const snapshot = await provider.start({
      actorId: input.actor.actorId,
      input: merged,
      testMode: input.testMode,
      waitForFinishSec: input.testMode ? 55 : 0,
    });
    await prisma.actorRun.update({
      where: { id: row.id },
      data: {
        externalRunId: snapshot.externalRunId,
        datasetId: snapshot.datasetId,
        status: snapshot.status as ScraperRunStatus,
        error: snapshot.message,
        completedAt: isTerminal(snapshot.status) ? new Date() : null,
        durationMs: durationSince(row.startedAt),
      },
    });
    return row.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Actor failed to start";
    await prisma.actorRun.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        error: message,
        errorCount: 1,
        completedAt: new Date(),
      },
    });
    await prisma.apifyActor.update({
      where: { id: input.actor.id },
      data: { errorCount: { increment: 1 } },
    });
    if (input.campaignRunId) {
      await prisma.campaignRun.update({
        where: { id: input.campaignRunId },
        data: { errorCount: { increment: 1 } },
      });
    }
    return row.id;
  }
}

export async function syncCampaignRun(campaignRunId: string) {
  const run = await prisma.campaignRun.findUnique({
    where: { id: campaignRunId },
    include: {
      campaign: true,
      actorRuns: { include: { actor: true } },
    },
  });
  if (!run) throw new Error("Campaign run not found");

  for (const actorRun of run.actorRuns) {
    if (isTerminal(actorRun.status) && actorRun.resultCount > 0) continue;
    if (isTerminal(actorRun.status) && !actorRun.datasetId) continue;
    if (!actorRun.externalRunId) continue;
    try {
      const snapshot = await getActorProvider(actorRun.provider).status(actorRun.externalRunId);
      await prisma.actorRun.update({
        where: { id: actorRun.id },
        data: {
          status: snapshot.status as ScraperRunStatus,
          datasetId: snapshot.datasetId ?? actorRun.datasetId,
          error: snapshot.message,
          completedAt: isTerminal(snapshot.status) ? new Date() : null,
          durationMs: durationSince(actorRun.startedAt),
        },
      });
    } catch (error) {
      await prisma.actorRun.update({
        where: { id: actorRun.id },
        data: {
          error: error instanceof Error ? error.message : "Status check failed",
        },
      });
    }
  }

  const fresh = await prisma.campaignRun.findUnique({
    where: { id: campaignRunId },
    include: { actorRuns: { include: { actor: true } }, campaign: true },
  });
  if (!fresh) throw new Error("Campaign run not found");

  const pending = fresh.actorRuns.filter((item) => !isTerminal(item.status));
  if (pending.length > 0) {
    return { status: fresh.status, pending: pending.length, completed: false };
  }

  if (fresh.status === "COMPLETED" || fresh.status === "FAILED") {
    return { status: fresh.status, pending: 0, completed: true };
  }

  return finalizeCampaignRun(fresh.id);
}

export async function syncStandaloneActorRun(actorRunId: string) {
  const row = await prisma.actorRun.findUnique({
    where: { id: actorRunId },
    include: { actor: true },
  });
  if (!row) throw new Error("Actor run not found");
  if (row.externalRunId && !isTerminal(row.status)) {
    const snapshot = await getActorProvider(row.provider).status(row.externalRunId);
    await prisma.actorRun.update({
      where: { id: row.id },
      data: {
        status: snapshot.status as ScraperRunStatus,
        datasetId: snapshot.datasetId ?? row.datasetId,
        error: snapshot.message,
        completedAt: isTerminal(snapshot.status) ? new Date() : null,
        durationMs: durationSince(row.startedAt),
      },
    });
  }
  const updated = await prisma.actorRun.findUnique({
    where: { id: actorRunId },
    include: { actor: true },
  });
  if (!updated) throw new Error("Actor run not found");
  if (updated.status === "SUCCEEDED" && updated.datasetId && updated.resultCount === 0) {
    await collectActorResults(updated.id);
  }
  return prisma.actorRun.findUnique({ where: { id: actorRunId } });
}

async function finalizeCampaignRun(campaignRunId: string) {
  const run = await prisma.campaignRun.findUnique({
    where: { id: campaignRunId },
    include: { actorRuns: { include: { actor: true } }, campaign: true },
  });
  if (!run) throw new Error("Campaign run not found");

  let collected = 0;
  let duplicates = 0;
  let created = 0;
  let errors = run.actorRuns.filter((item) => item.status === "FAILED").length;
  const newLeadIds: string[] = [];

  for (const actorRun of run.actorRuns) {
    if (actorRun.status !== "SUCCEEDED" || !actorRun.datasetId) continue;
    try {
      const result = await collectActorResults(actorRun.id, run.campaignId);
      collected += result.collected;
      duplicates += result.duplicates;
      created += result.stored;
      newLeadIds.push(...result.storedIds);
    } catch (error) {
      errors += 1;
      await prisma.actorRun.update({
        where: { id: actorRun.id },
        data: {
          error: error instanceof Error ? error.message : "Result collection failed",
          errorCount: { increment: 1 },
        },
      });
    }
  }

  const failedAll = run.actorRuns.length > 0 && run.actorRuns.every((item) => item.status === "FAILED");
  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: {
      status: failedAll ? "FAILED" : "COMPLETED",
      leadsCollected: collected,
      duplicatesRemoved: duplicates,
      newLeads: created,
      errorCount: errors,
      completedAt: new Date(),
    },
  });
  await prisma.campaign.update({
    where: { id: run.campaignId },
    data: { status: failedAll ? "DRAFT" : "COMPLETED" },
  });

  if (run.campaign.sheetSpreadsheetId && run.campaign.sheetWorksheet) {
    try {
      await exportCampaignLeads(run.campaignId, run.campaign.sheetSpreadsheetId, run.campaign.sheetWorksheet);
    } catch (error) {
      if (!(error instanceof IntegrationPendingError)) {
        await writeAudit({
          action: "campaign.sheet_export_failed",
          entity: "campaign_run",
          entityId: campaignRunId,
          payload: { error: error instanceof Error ? error.message : "export failed" },
        });
      }
    }
  }

  if (run.campaign.runAiAfterScrape && newLeadIds.length) {
    for (const leadId of newLeadIds.slice(0, 25)) {
      await enqueue({ type: "PIPELINE_LEAD", leadId });
    }
    await processQueue(3);
  }

  return { status: failedAll ? "FAILED" : "COMPLETED", pending: 0, completed: true };
}

async function collectActorResults(actorRunId: string, campaignId?: string) {
  const row = await prisma.actorRun.findUnique({
    where: { id: actorRunId },
    include: { actor: true },
  });
  if (!row?.datasetId) return { collected: 0, stored: 0, duplicates: 0, storedIds: [] as string[] };

  const limit = row.testMode ? TEST_LIMIT : FULL_LIMIT;
  const items = await getActorProvider(row.provider).results(row.datasetId, limit);
  const ingested = await ingestActorItems({
    actor: row.actor,
    items,
    runId: row.externalRunId,
    datasetId: row.datasetId,
    campaignId: campaignId ?? null,
  });

  await prisma.actorRun.update({
    where: { id: row.id },
    data: {
      resultCount: items.length,
      ingestedNew: ingested.stored,
    },
  });
  await prisma.apifyActor.update({
    where: { id: row.apifyActorId },
    data: {
      lastSuccessAt: new Date(),
      leadsGenerated: { increment: ingested.stored },
      avgDurationMs: row.durationMs ?? undefined,
    },
  });

  return {
    collected: items.length,
    stored: ingested.stored,
    duplicates: ingested.duplicates,
    storedIds: ingested.storedIds,
  };
}

export async function exportCampaignLeads(
  campaignId: string,
  spreadsheetId: string,
  worksheet: string,
) {
  const leads = await prisma.lead.findMany({
    where: { campaignLeads: { some: { campaignId } } },
    orderBy: { createdAt: "asc" },
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const header = [
    "lead_id",
    "name",
    "company",
    "website",
    "email",
    "phone",
    "location",
    "source",
    "source_actor",
    "qualification_score",
    "recommended_service",
  ];
  await exportEnrichedRows({
    spreadsheetId,
    worksheet,
    rows: [
      header,
      ...leads.map((lead) => [
        lead.leadId,
        lead.name,
        lead.company,
        lead.website,
        lead.email,
        lead.phone,
        lead.location,
        lead.source,
        lead.sourceActor,
        lead.scores[0]?.score ?? "",
        lead.opportunities[0]?.recommendedService ?? "",
      ]),
    ],
  });
  return { exported: leads.length };
}

function isTerminal(status: string) {
  return ["SUCCEEDED", "FAILED", "ABORTED", "TIMED_OUT"].includes(status);
}

function durationSince(startedAt: Date | null) {
  if (!startedAt) return null;
  return Date.now() - startedAt.getTime();
}

function asRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
