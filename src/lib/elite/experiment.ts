import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { setSetting, writeAudit } from "@/lib/db/settings";
import { ingestLeads } from "@/lib/leads/ingest";
import { getApifyToken } from "@/lib/secrets";
import { fetchPublicPage } from "@/lib/scraping/providers/http-fetch";
import { FirecrawlProvider } from "@/lib/scraping/providers/firecrawl";
import { isNonBuyerDiscoveryHost } from "@/lib/scraping/non-buyer-host";
import {
  ELITE_LAYER1_SOURCES,
  FIRST_ELITE_EXPERIMENT,
  matchLayer1Actor,
  searchTermsFor,
  type EliteEcosystemId,
} from "@/lib/elite/catalog";
import { extractDecisionMakersFromText } from "@/lib/elite/people";
import { scoreEliteProspect } from "@/lib/elite/signals";

const EXPERIMENT_KEY = "elite.experiment.latest";

function temperatureFor(total: number) {
  if (total >= 80) return "HOT" as const;
  if (total >= 60) return "WARM" as const;
  if (total >= 40) return "COLD" as const;
  return "DISQUALIFIED" as const;
}

async function queueResearch(leadId: string) {
  await prisma.task.create({
    data: {
      type: "PIPELINE_LEAD",
      payload: { elite: true, engine: true } as Prisma.InputJsonValue,
      leadId,
      status: "QUEUED",
    },
  });
}

export async function runEliteExperiment(input: {
  market?: string;
  ecosystemIds?: EliteEcosystemId[];
  cap?: number;
} = {}) {
  const market = input.market ?? FIRST_ELITE_EXPERIMENT.market;
  const ecosystemIds = input.ecosystemIds ?? FIRST_ELITE_EXPERIMENT.ecosystemIds;
  const cap = Math.min(Math.max(input.cap ?? FIRST_ELITE_EXPERIMENT.cap, 20), FIRST_ELITE_EXPERIMENT.cap);
  const terms = searchTermsFor(market, ecosystemIds);
  const notes: string[] = [];
  const sourceRuns: Array<{ source: string; ok: boolean; detail: string }> = [];

  const apify = await getApifyToken().catch(() => ({ token: null as string | null }));
  const actors = await prisma.apifyActor.findMany({ where: { active: true } });
  const layer1 = actors
    .map((actor) => ({ actor, source: matchLayer1Actor(actor) }))
    .filter((row): row is { actor: (typeof actors)[number]; source: string } => Boolean(row.source));

  let remaining = cap;
  if (apify.token && layer1.length) {
    const { runConfiguredActorJob } = await import("@/lib/apify/job");
    for (const row of layer1) {
      if (remaining <= 0) break;
      const limit = Math.min(80, remaining);
      const report = await runConfiguredActorJob({
        apifyActorId: row.actor.id,
        testMode: false,
        ingest: true,
        pipeline: false,
        limit,
        inputOverride: {
          searchStringsArray: terms.slice(0, 8),
          locationQuery: market,
          location: market,
        },
      }).catch((error) => ({
        actorName: row.actor.displayName,
        leadsCreated: 0,
        items: 0,
        error: error instanceof Error ? error.message : String(error),
      }));
      remaining -= report.leadsCreated;
      sourceRuns.push({
        source: row.actor.displayName,
        ok: !report.error,
        detail: report.error ?? `${report.leadsCreated} new leads · ${report.items} items`,
      });
      if (report.error && /usage hard limit|quota|payment/i.test(report.error)) {
        notes.push("Apify monthly limit hit. Remaining Maps actors were skipped. Firecrawl search still runs.");
        break;
      }
    }
  } else {
    notes.push(
      apify.token
        ? "No Google Maps / keyword / no-website actors are registered yet. Add them under Actors, then rerun."
        : "Apify token missing. Maps scrapers were skipped. Website/API layers can still run.",
    );
  }

  try {
    const firecrawl = new FirecrawlProvider();
    const search = await firecrawl.search({ query: terms.slice(0, 6).join(" OR "), maxRequests: Math.min(25, cap) });
    const leads = search.records
      .slice(0, Math.min(40, remaining))
      .filter((record) => !isNonBuyerDiscoveryHost(record.sourceUrl))
      .map((record) => ({
        company: String(record.normalizedFields.title ?? record.sourceUrl),
        website: record.sourceUrl,
        location: market,
        industry: ecosystemIds.join(", "),
        source: "elite_firecrawl_search",
        notes: `Elite search: ${market}. ${String(record.normalizedFields.description ?? "")}`.slice(0, 500),
        sourceActor: "firecrawl",
        sourceUrl: record.sourceUrl,
      }));
    const ingested = await ingestLeads({ leads, sourceName: "elite_firecrawl_search" });
    remaining -= ingested.stored;
    sourceRuns.push({
      source: "Firecrawl search",
      ok: true,
      detail: `${ingested.stored} new · ${ingested.duplicates} duplicates`,
    });
  } catch (error) {
    sourceRuns.push({
      source: "Firecrawl search",
      ok: false,
      detail: error instanceof Error ? error.message : "Search unavailable",
    });
  }

  const existing = await prisma.lead.findMany({
    where: {
      OR: [
        { location: { contains: market, mode: "insensitive" } },
        { notes: { contains: market, mode: "insensitive" } },
        { originalPost: { contains: market, mode: "insensitive" } },
        { industry: { contains: "jet", mode: "insensitive" } },
        { industry: { contains: "yacht", mode: "insensitive" } },
        { industry: { contains: "real estate", mode: "insensitive" } },
      ],
    },
    orderBy: { lastActivityAt: "desc" },
    take: cap,
  });

  const scoredRows = [];
  let websitesScraped = 0;
  for (const lead of existing) {
    let extraNotes = lead.notes ?? "";
    let roleTitle: string | null = null;
    if (lead.website && websitesScraped < 12) {
      try {
        const host = new URL(lead.website).hostname;
        const page = await fetchPublicPage(lead.website, [host]);
        websitesScraped += 1;
        const text = `${page.rawEvidence.title ?? ""} ${page.rawEvidence.text ?? ""}`;
        const people = extractDecisionMakersFromText(text);
        if (people[0]) {
          roleTitle = people[0].role;
          extraNotes = `${extraNotes}\nDecision maker from public site: ${people[0].name ?? "unnamed"} · ${people[0].role}.`.trim();
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              name: lead.name ?? people[0].name,
              notes: extraNotes,
            },
          });
        }
      } catch {
        websitesScraped += 1;
      }
    }

    const scored = scoreEliteProspect({
      company: lead.company,
      industry: lead.industry,
      location: lead.location ?? market,
      website: lead.website,
      email: lead.email,
      linkedinUrl: lead.linkedinUrl,
      roleTitle,
      notes: extraNotes,
      originalPost: lead.originalPost,
    });
    await prisma.leadScore.create({
      data: {
        leadId: lead.id,
        score: scored.total,
        temperature: temperatureFor(scored.total),
        reason: scored.narrative,
        breakdown: {
          elite: true,
          band: scored.band,
          signals: scored.signals,
          commercial: scored.commercial.total,
          offer: scored.offer,
        },
        evidenceUsed: scored.signals.filter((item) => item.present).map((item) => item.evidence),
        mode: "elite",
      },
    });
    await prisma.leadSignalSet.create({
      data: {
        leadId: lead.id,
        payload: {
          version: 1,
          kind: "elite",
          signals: scored.signals,
          narrative: scored.narrative,
          market,
          ecosystemIds,
          offer: scored.offer,
          pitch: scored.pitch,
        },
      },
    });
    await prisma.opportunity.create({
      data: {
        leadId: lead.id,
        problem: scored.narrative,
        evidence:
          scored.signals
            .filter((item) => item.present)
            .map((item) => item.evidence)
            .join(" ")
            .slice(0, 1000) || "Elite heuristic match.",
        recommendedService: scored.offer.zarService,
        suggestedOffer: scored.pitch,
        projectCategory: scored.offer.primary,
        nextStep: "Draft after you approve. Kill switch and draft-only still apply. Do not send.",
        confidence: scored.rejected ? "unknown" : "inferred",
        score: scored.offer.scores[scored.offer.primary],
        mode: "elite",
      },
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { temperature: temperatureFor(scored.total), lastActivityAt: new Date() },
    });
    scoredRows.push({
      id: lead.id,
      leadId: lead.leadId,
      company: lead.company,
      total: scored.total,
      band: scored.band,
      narrative: scored.narrative,
      pitch: scored.pitch,
      offer: scored.offer.primary,
      secondary: scored.offer.secondary,
    });
  }

  const priority = scoredRows.filter((row) => row.band.code === "priority").slice(0, FIRST_ELITE_EXPERIMENT.pipelinePriorityCap);
  for (const row of priority) {
    await queueResearch(row.id);
  }
  if (priority.length) {
    notes.push("Priority research tasks were queued. They will run from Queue — nothing was auto-sent.");
  }

  const { syncLeadsWorkbook } = await import("@/lib/google/sync");
  const sheet = await syncLeadsWorkbook();
  notes.push(sheet.ok ? sheet.message : `Google Sheet not updated: ${sheet.message}`);

  const summary = {
    id: FIRST_ELITE_EXPERIMENT.id,
    market,
    ecosystemIds,
    cap,
    terms,
    sources: ELITE_LAYER1_SOURCES.map((item) => item.label),
    sourceRuns,
    notes,
    scored: scoredRows.length,
    bands: {
      priority: scoredRows.filter((row) => row.band.code === "priority").length,
      qualified: scoredRows.filter((row) => row.band.code === "qualified").length,
      review: scoredRows.filter((row) => row.band.code === "review").length,
      reject: scoredRows.filter((row) => row.band.code === "reject").length,
    },
    pipelineQueued: priority.length,
    pitches: scoredRows
      .filter((row) => row.band.code !== "reject")
      .slice(0, 20)
      .map((row) => ({
        company: row.company,
        offer: row.offer,
        secondary: row.secondary,
        pitch: row.pitch,
        total: row.total,
        band: row.band.code,
      })),
    send: "unchanged — kill switch and draft_only still apply. Nothing was auto-sent.",
    sheet,
    at: new Date().toISOString(),
  };
  await setSetting(EXPERIMENT_KEY, summary);
  await writeAudit({ action: "elite.experiment.run", entity: "elite", payload: summary });
  return summary;
}

export async function getLatestEliteExperiment() {
  const { getSetting } = await import("@/lib/db/settings");
  return getSetting<Awaited<ReturnType<typeof runEliteExperiment>> | null>(EXPERIMENT_KEY, null);
}
