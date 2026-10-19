"use client";

import { useState } from "react";
import Link from "next/link";

import { runLeadScrapeAction } from "@/lib/actions/actors";
import { runAllZarScrapersAction, runFullScrapeThenSheetAction, runZarScrapeAction } from "@/lib/actions/scraping";
import { formatDiscoverDoneBanner } from "@/lib/scraping/discover-report-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskRunBanner, useTaskRun } from "@/components/ui/task-run-status";

export type ZarScraperOption = { slug: string; name: string; provider: string };
export type LeadScrapeActorOption = { id: string; displayName: string; actorId: string };

export function ScrapeNowControls({
  scrapers = [],
  actors = [],
  hideFlagship = false,
}: {
  scrapers?: ZarScraperOption[];
  actors?: LeadScrapeActorOption[];
  hideFlagship?: boolean;
}) {
  const scrape = useTaskRun();
  const pipeline = useTaskRun();
  const [url, setUrl] = useState("");
  const [scraper, setScraper] = useState(scrapers[0]?.slug ?? "website-http");
  const [operation, setOperation] = useState<"scrape" | "crawl">("scrape");
  const [runAll, setRunAll] = useState(true);
  const [actorId, setActorId] = useState(actors[0]?.id ?? "");

  return (
    <div>
      {!hideFlagship ? (
      <div className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4">
        <p className="text-[11px] uppercase tracking-wider text-emerald-300">Elite lead engine</p>
        <p className="mt-1 text-sm text-white">
          Discover candidates, then classify PRIORITY / NURTURE / REJECT. Does not research deeply, draft, or send.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pipeline.pending || scrape.pending}
            onClick={() =>
              pipeline.run(async () => {
                const report = await runFullScrapeThenSheetAction({
                  url: url.trim() || undefined,
                  operation,
                });
                const lines = [
                  report.message,
                  ...report.steps.map(
                    (step) => `${step.name}: ${step.ok ? "ok" : "failed"} (${step.attempts} try) · ${step.detail}`,
                  ),
                ];
                if (!report.ok) throw new Error(lines.join("\n"));
                return [formatDiscoverDoneBanner({ discovery: report.discovery, classification: report.classification }), ...lines];
              })
            }
          >
            {pipeline.pending ? "Discovering…" : "Discover Elite Leads → Google Sheet"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Apify Maps/keyword first. Then Firecrawl / HTTP / Chrome if quota is hit. New companies are candidates.
          The metric is PRIORITY opportunities, not ingest count. Nothing is sent.
        </p>
        <TaskRunBanner phase={pipeline.phase} lines={pipeline.lines} />
      </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1 text-xs text-muted">
          Public URL
          <Input
            className="mt-1"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={scrape.pending}
          />
        </label>
        <label className="text-xs text-muted">
          Engine
          <select
            className="mt-1 h-10 min-w-[180px] rounded-lg border border-emerald-500/20 bg-black/40 px-3 text-sm text-white"
            value={scraper}
            onChange={(event) => setScraper(event.target.value)}
            disabled={scrape.pending || runAll}
          >
            {(scrapers.length
              ? scrapers
              : [
                  { slug: "website-http", name: "Website HTTP", provider: "crawlee" },
                  { slug: "website-browser", name: "Website Browser", provider: "playwright" },
                  { slug: "website-crawl4ai", name: "Website Crawl4AI", provider: "crawl4ai" },
                  { slug: "firecrawl", name: "Firecrawl", provider: "firecrawl" },
                ]
            ).map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Mode
          <select
            className="mt-1 h-10 rounded-lg border border-emerald-500/20 bg-black/40 px-3 text-sm text-white"
            value={operation}
            onChange={(event) => setOperation(event.target.value as "scrape" | "crawl")}
            disabled={scrape.pending}
          >
            <option value="scrape">One page</option>
            <option value="crawl">Same-site crawl</option>
          </select>
        </label>
        <Button
          type="button"
          disabled={scrape.pending || !url.trim()}
          onClick={() =>
            scrape.run(async () => {
              if (runAll) {
                const result = await runAllZarScrapersAction({ url, operation });
                const lines = [
                  `Scrapers finished. Success ${result.successful} · failed ${result.failed} · ingested ${result.totalIngested} · duplicates ${result.totalDuplicates}.`,
                  ...result.runs.map((run) =>
                    `${run.scraper}: ${run.status} · found ${run.recordsFound} · stored ${run.recordsStored} · leads ${run.ingested}${
                      run.error ? ` · ${run.error}` : ""
                    }`,
                  ),
                  result.sheet?.message ?? "Google Sheet sync skipped because no scraper succeeded.",
                  "Now click Run Today's Outreach. Nothing was sent by discovery.",
                ];
                if (result.status !== "COMPLETED") throw new Error(lines.join("\n"));
                return lines;
              }
              const result = await runZarScrapeAction({ url, scraper, operation });
              if (result.error) throw new Error(result.error);
              const sheet = result.sheet;
              return [
                `${result.scraper} ${result.status}. Found ${result.recordsFound} · stored ${result.recordsStored} · ingested ${result.ingested ?? 0} leads.`,
                sheet?.message ?? "Google Sheet updated.",
                sheet?.url ? `Sheet: ${sheet.url}` : "",
                "Already-sent leads are marked SENT on the sheet. Nothing new was sent.",
              ].filter(Boolean);
            })
          }
        >
          {scrape.pending ? "Running…" : runAll ? "Run all scrapers" : "Run scrape now"}
        </Button>
        <label className="flex h-10 items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={runAll}
            onChange={(event) => setRunAll(event.target.checked)}
            disabled={scrape.pending}
          />
          Use all engines
        </label>
        <Link href="/integrations/scraping" className="text-sm text-emerald-300">
          Elite Lead Engine
        </Link>
      </div>
      {actors.length ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Optional Apify actor
            <select
              className="mt-1 h-10 min-w-[220px] rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white"
              value={actorId}
              onChange={(event) => setActorId(event.target.value)}
              disabled={scrape.pending}
            >
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.displayName}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={scrape.pending || !actorId}
            onClick={() =>
              scrape.run(async () => {
                const result = await runLeadScrapeAction(actorId);
                if (result.error) throw new Error(result.error);
                return [
                  `Apify ${result.status}. Items ${result.items} · new leads ${result.leadsCreated} · duplicates ${result.duplicates} · removed ${result.excluded ?? 0} (agency/tech).`,
                  result.sheet?.message ?? "Google Sheet updated.",
                  "Already-sent leads are marked SENT on the sheet. Nothing new was sent.",
                ];
              })
            }
          >
            {scrape.pending ? "Running…" : "Run Apify actor"}
          </Button>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted">
        Default path runs Website HTTP → Browser → Crawl4AI → Firecrawl with one retry per failed engine. Public HTTP(S)
        only. Not LinkedIn or Fiverr scrape. Does not send.
      </p>
      <TaskRunBanner phase={scrape.phase} lines={scrape.lines} />
    </div>
  );
}
