import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ApifyNotConfiguredError, ApifyService } from "@/lib/apify/service";
import { runActor, type ApifyRunClient } from "@/lib/apify/tool";
import { getApifyToken } from "@/lib/secrets";
import { ingestLeads } from "@/lib/leads/ingest";
import { writeAudit } from "@/lib/db/settings";
import { buildTwitterSearchInput, DEFAULT_X_INTENT_QUERIES } from "@/lib/twitter/intent-queries";
import { mapTweetItemsToLeads } from "@/lib/twitter/map-tweet";

/** Public Apify tweet search actor used for your business service-intent discovery. */
export const TWITTER_INTENT_ACTOR_ID = "apidojo/tweet-scraper";

async function liveApifyClient(): Promise<ApifyRunClient> {
  const token = await getApifyToken();
  const service = new ApifyService();
  return {
    configured: Boolean(token.token),
    startRun: (input) => service.startRun(input),
    getDatasetItems: (datasetId, limit) => service.getDatasetItems(datasetId, limit),
  };
}

export async function ensureTwitterIntentActor() {
  const existing = await prisma.apifyActor.findUnique({ where: { actorId: TWITTER_INTENT_ACTOR_ID } });
  if (existing) {
    if (!existing.active) {
      await prisma.apifyActor.update({ where: { id: existing.id }, data: { active: true } });
    }
    return existing;
  }

  const service = new ApifyService();
  let inputSchema: Record<string, unknown> = {};
  let description: string | null =
    "Search X/Twitter for people seeking custom software, AI automation, websites, and related services.";
  try {
    const meta = await service.getActorMeta(TWITTER_INTENT_ACTOR_ID);
    inputSchema = (meta.inputSchema as Record<string, unknown>) ?? {};
    description = meta.description || description;
  } catch {
    // Still register so the operator can fix token / actor access later.
  }

  return prisma.apifyActor.create({
    data: {
      actorId: TWITTER_INTENT_ACTOR_ID,
      displayName: "X / Twitter intent search (your business)",
      description,
      platform: "X / Twitter",
      category: "discovery",
      sourceType: "twitter_intent",
      inputSchema: inputSchema as Prisma.InputJsonValue,
      inputValues: buildTwitterSearchInput({ maxItems: 40 }) as Prisma.InputJsonValue,
      outputMapping: {
        name: "author.name",
        twitterUrl: "author.url",
        originalPost: "fullText",
        sourceUrl: "url",
        location: "author.location",
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Discover people on X who appear to need your services services.
 * Uses Apify tweet search — needs APIFY_API_TOKEN, not an X login.
 * Scraped ≠ outreach-eligible; Decision Maker still gates sends.
 */
export async function discoverTwitterIntentLeads(input: {
  maxItems?: number;
  dryRun?: boolean;
  queries?: string[];
} = {}) {
  const token = await getApifyToken();
  if (!token.token) {
    return {
      ok: false as const,
      error: "Apify is not connected. Save an Apify token in Integrations → API Keys to scrape X intent leads.",
      actorId: TWITTER_INTENT_ACTOR_ID,
      queries: [...DEFAULT_X_INTENT_QUERIES],
      items: 0,
      kept: 0,
      skipped: 0,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      runId: null as string | null,
      preview: [] as unknown[],
    };
  }

  const actor = await ensureTwitterIntentActor();
  const runInput = buildTwitterSearchInput({
    maxItems: input.maxItems ?? 40,
    queries: input.queries,
  });

  await prisma.apifyActor.update({
    where: { id: actor.id },
    data: {
      inputValues: runInput as Prisma.InputJsonValue,
      lastRunAt: new Date(),
      totalRuns: { increment: 1 },
    },
  });

  const row = await prisma.actorRun.create({
    data: {
      apifyActorId: actor.id,
      status: "STARTING",
      testMode: true,
      input: runInput as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
  });

  const client = await liveApifyClient();
  let result;
  try {
    result = await runActor(
      {
        actorId: actor.actorId,
        runInput,
        testMode: false,
        itemLimit: Number(runInput.maxItems) || 40,
      },
      client,
    );

    // Tweet search often needs >60s; poll if Apify returned early.
    if (result.runId && result.status === "RUNNING") {
      const service = new ApifyService();
      const { mapApifyStatus } = await import("@/lib/apify/ids");
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 8_000));
        const snap = await service.getRun(result.runId);
        const status = mapApifyStatus(snap.status);
        if (status === "SUCCEEDED") {
          const items = snap.defaultDatasetId
            ? await service.getDatasetItems(snap.defaultDatasetId, Number(runInput.maxItems) || 40)
            : [];
          result = {
            ...result,
            status,
            datasetId: snap.defaultDatasetId,
            items,
            itemCount: items.length,
            finishedAt: snap.finishedAt,
            error: snap.statusMessage,
          };
          break;
        }
        if (status === "FAILED" || status === "ABORTED" || status === "TIMED_OUT") {
          result = {
            ...result,
            status,
            error: snap.statusMessage || `Actor ${status}`,
            finishedAt: snap.finishedAt,
          };
          break;
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Twitter actor failed.";
    await prisma.actorRun.update({
      where: { id: row.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
    return {
      ok: false as const,
      error: message,
      actorId: actor.actorId,
      queries: (runInput.searchTerms as string[]) ?? [],
      items: 0,
      kept: 0,
      skipped: 0,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      runId: null,
      preview: [],
    };
  }

  await prisma.actorRun.update({
    where: { id: row.id },
    data: {
      status: result.status,
      externalRunId: result.runId,
      datasetId: result.datasetId,
      resultCount: result.itemCount,
      error: result.error,
      completedAt: new Date(),
    },
  });

  if (result.status !== "SUCCEEDED") {
    return {
      ok: false as const,
      error: result.error || `Actor finished with status ${result.status}`,
      actorId: actor.actorId,
      queries: (runInput.searchTerms as string[]) ?? [],
      items: result.itemCount,
      kept: 0,
      skipped: 0,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      runId: result.runId,
      preview: result.items.slice(0, 3),
    };
  }

  const mapped = mapTweetItemsToLeads(result.items, {
    source: "twitter_intent",
    sourceActor: actor.actorId,
  });
  const rawUseful = result.items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as Record<string, unknown>).noResults !== true;
  }).length;

  if (input.dryRun) {
    await writeAudit({
      action: "discover.twitter_intent.dry_run",
      entity: "apify_actor",
      entityId: actor.id,
      payload: { items: result.itemCount, kept: mapped.kept, skipped: mapped.skipped },
    });
    return {
      ok: true as const,
      error: null as string | null,
      actorId: actor.actorId,
      queries: (runInput.searchTerms as string[]) ?? [],
      items: rawUseful,
      kept: mapped.kept,
      skipped: mapped.skipped,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      runId: result.runId,
      preview: mapped.leads.slice(0, 5).map((lead) => ({
        name: lead.name,
        twitterUrl: lead.twitterUrl,
        originalPost: lead.originalPost?.slice(0, 160),
      })),
    };
  }

  const ingested = await ingestLeads({
    leads: mapped.leads,
    sourceName: "twitter_intent",
  });

  await prisma.apifyActor.update({
    where: { id: actor.id },
    data: {
      lastSuccessAt: new Date(),
      leadsGenerated: { increment: ingested.stored },
    },
  });

  await writeAudit({
    action: "discover.twitter_intent",
    entity: "apify_actor",
    entityId: actor.id,
    payload: {
      items: rawUseful,
      kept: mapped.kept,
      skipped: mapped.skipped,
      stored: ingested.stored,
      duplicates: ingested.duplicates,
      runId: result.runId,
    },
  });

  return {
    ok: true as const,
    error: null as string | null,
    actorId: actor.actorId,
    queries: (runInput.searchTerms as string[]) ?? [],
    items: rawUseful,
    kept: mapped.kept,
    skipped: mapped.skipped,
    stored: ingested.stored,
    duplicates: ingested.duplicates,
    leadIds: ingested.storedIds,
    runId: result.runId,
    preview: mapped.leads.slice(0, 5).map((lead) => ({
      name: lead.name,
      twitterUrl: lead.twitterUrl,
      originalPost: lead.originalPost?.slice(0, 160),
    })),
  };
}

export async function twitterDiscoveryReady() {
  try {
    const token = await getApifyToken();
    return { apifyConfigured: Boolean(token.token), actorId: TWITTER_INTENT_ACTOR_ID };
  } catch (error) {
    if (error instanceof ApifyNotConfiguredError) {
      return { apifyConfigured: false, actorId: TWITTER_INTENT_ACTOR_ID };
    }
    return { apifyConfigured: false, actorId: TWITTER_INTENT_ACTOR_ID };
  }
}
