import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { applyResultCap } from "../src/lib/apify/ids";
import { collectKeys, guessMapping, mapActorItem } from "../src/lib/actors/mapping";
import { apifySourceRef, mergeSourceRefs, wrapApifyRecord } from "../src/lib/apify/lineage";
import { createLeadId } from "../src/lib/leads/ids";
import { normalizeLead } from "../src/lib/leads/normalize";

const ROOT = resolve(import.meta.dirname ?? ".", "..");

function loadLocalEnv() {
  const text = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function token() {
  const value = (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN)?.trim();
  if (!value) throw new Error("APIFY_TOKEN is empty");
  return value;
}

async function apify<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T }> {
  const response = await fetch(`https://api.apify.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, body };
}

const TINY_INPUT = {
  searchStringsArray: ["restaurant"],
  locationQuery: "New York, USA",
  maxCrawledPlacesPerSearch: 5,
  language: "en",
  scrapePlaceDetailPage: false,
  scrapeContacts: false,
  scrapeReviewsPersonalData: false,
  maxReviews: 0,
  maxImages: 0,
  includeWebResults: false,
};

async function main() {
  loadLocalEnv();
  const me = await apify<{ data?: { username?: string; plan?: { id?: string } }; error?: { message?: string } }>(
    "/users/me",
  );
  if (!me.ok) {
    console.log(JSON.stringify({ connected: false, status: me.status, error: me.body.error?.message ?? "auth_failed" }));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      connected: true,
      username: me.body.data?.username ?? null,
      plan: me.body.data?.plan?.id ?? null,
    }),
  );

  const actorId = "nwua9Gu5YrADL7ZDj";
  const meta = await apify<{ data?: { title?: string; name?: string; description?: string } }>(`/acts/${actorId}`);
  const displayName = meta.body.data?.title ?? meta.body.data?.name ?? "Google Maps Lead Scraper";
  const prisma = new PrismaClient();

  const actor = await prisma.apifyActor.upsert({
    where: { actorId },
    update: {
      displayName,
      description: meta.body.data?.description ?? undefined,
      platform: "Google Maps",
      category: "Lead Generation",
      sourceType: "google_maps",
      active: true,
      inputValues: TINY_INPUT,
    },
    create: {
      actorId,
      displayName,
      description: meta.body.data?.description ?? null,
      platform: "Google Maps",
      category: "Lead Generation",
      sourceType: "google_maps",
      inputValues: TINY_INPUT,
    },
  });

  const runInput = applyResultCap(TINY_INPUT, { properties: { maxCrawledPlacesPerSearch: {} } }, true);
  const recent = await apify<{ data?: { items?: Record<string, unknown>[] } }>(
    `/acts/${actorId}/runs?limit=1&desc=1`,
  );
  const latest = recent.body.data?.items?.[0];
  const latestOk =
    latest &&
    String(latest.status) === "SUCCEEDED" &&
    Date.now() - new Date(String(latest.finishedAt ?? latest.startedAt ?? 0)).getTime() < 15 * 60 * 1000;

  let run = latestOk ? latest : null;
  if (!run) {
    const started = await apify<{ data?: Record<string, unknown>; error?: { message?: string } }>(
      `/acts/${actorId}/runs?waitForFinish=55&timeout=180&memory=1024`,
      { method: "POST", body: JSON.stringify(runInput) },
    );
    if (!started.ok) {
      console.log(JSON.stringify({ actorSaved: actor.id, run: "FAILED", error: started.body.error?.message ?? started.status }));
      await prisma.$disconnect();
      process.exit(1);
    }
    run = started.body.data ?? {};
  }

  const runId = String(run.id ?? "");
  const datasetId = run.defaultDatasetId ? String(run.defaultDatasetId) : null;
  let runStatus = String(run.status ?? "UNKNOWN");

  if (runId && runStatus !== "SUCCEEDED" && runStatus !== "FAILED") {
    for (let attempt = 0; attempt < 8 && runStatus === "RUNNING"; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 8000));
      const polled = await apify<{ data?: Record<string, unknown> }>(`/actor-runs/${runId}`);
      run = polled.body.data ?? run;
      runStatus = String(run.status ?? runStatus);
    }
  }

  let items: unknown[] = [];
  if (datasetId) {
    const dataset = await apify<unknown[]>(`/datasets/${datasetId}/items?limit=5&clean=true`);
    items = Array.isArray(dataset.body) ? dataset.body : [];
  }

  const mapping = guessMapping(collectKeys(items));
  const ref = apifySourceRef({ actorId, runId, datasetId });
  let stored = 0;
  let duplicates = 0;
  const preview = [];

  for (const item of items) {
    const mapped = mapActorItem(item, mapping, { source: `apify:${actorId}`, sourceActor: actorId });
    const normalized = normalizeLead(mapped);
    if (!normalized.name && !normalized.company && !normalized.email && !normalized.website) continue;
    preview.push({
      company: normalized.company,
      website: normalized.website,
      email: normalized.email,
      phone: normalized.phone,
      location: normalized.location,
    });
    const existing = await prisma.lead.findFirst({
      where: {
        OR: [
          normalized.email ? { email: normalized.email } : undefined,
          normalized.websiteHost ? { websiteHost: normalized.websiteHost } : undefined,
        ].filter(Boolean) as object[],
      },
    });
    if (existing) {
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          sourceActor: existing.sourceActor ?? actorId,
          sourceRunId: existing.sourceRunId ?? runId,
          sourceDatasetId: existing.sourceDatasetId ?? datasetId,
          sourceRefs: mergeSourceRefs(existing.sourceRefs, ref),
        },
      });
      duplicates += 1;
      continue;
    }
    await prisma.lead.create({
      data: {
        leadId: createLeadId(),
        name: normalized.name,
        company: normalized.company,
        website: normalized.website,
        email: normalized.email,
        phone: normalized.phone,
        location: normalized.location,
        source: `apify:${actorId}`,
        sourceActor: actorId,
        sourceUrl: mapped.sourceUrl ?? null,
        sourceRunId: runId,
        sourceDatasetId: datasetId,
        sourceRefs: [ref],
        rawPayload: wrapApifyRecord(item, ref),
        websiteHost: normalized.websiteHost,
        missingFields: normalized.missingFields,
        status: "NEW",
      },
    });
    stored += 1;
  }

  await prisma.apifyActor.update({
    where: { id: actor.id },
    data: {
      outputMapping: mapping,
      lastRunAt: new Date(),
      lastSuccessAt: runStatus === "SUCCEEDED" ? new Date() : undefined,
      leadsGenerated: { increment: stored },
      totalRuns: { increment: 1 },
    },
  });
  await prisma.actorRun.create({
    data: {
      apifyActorId: actor.id,
      provider: "apify",
      externalRunId: runId || null,
      datasetId,
      status: runStatus === "SUCCEEDED" ? "SUCCEEDED" : runStatus === "FAILED" ? "FAILED" : "RUNNING",
      testMode: true,
      input: runInput,
      resultCount: items.length,
      ingestedNew: stored,
      error: runStatus === "SUCCEEDED" ? null : String(run.statusMessage ?? runStatus),
      startedAt: run.startedAt ? new Date(String(run.startedAt)) : new Date(),
      completedAt: run.finishedAt ? new Date(String(run.finishedAt)) : new Date(),
    },
  });
  await prisma.integration.upsert({
    where: { kind: "APIFY" },
    update: {
      health: "CONNECTED",
      name: "Apify",
      publicConfig: { username: me.body.data?.username, plan: me.body.data?.plan?.id },
      lastCheckedAt: new Date(),
      lastError: null,
    },
    create: {
      kind: "APIFY",
      name: "Apify",
      health: "CONNECTED",
      publicConfig: { username: me.body.data?.username, plan: me.body.data?.plan?.id },
      lastCheckedAt: new Date(),
    },
  });

  console.log(
    JSON.stringify({
      actorId,
      displayName,
      mapping,
      runId: runId || null,
      datasetId,
      status: runStatus,
      items: items.length,
      leadsCreated: stored,
      duplicates,
      preview,
      sent: 0,
    }),
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : "smoke_failed" }));
  process.exit(1);
});
