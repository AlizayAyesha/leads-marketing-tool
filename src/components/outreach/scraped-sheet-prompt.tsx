"use client";

import Link from "next/link";

import { runLiveOutreachAction } from "@/lib/actions/outreach";
import { summarizeLiveRun } from "@/lib/outreach/live-run-copy";
import {
  ScrapeNowControls,
  type LeadScrapeActorOption,
  type ZarScraperOption,
} from "@/components/outreach/scrape-now-controls";
import { Button } from "@/components/ui/button";
import { TaskRunBanner, useTaskRun } from "@/components/ui/task-run-status";

export type { LeadScrapeActorOption, ZarScraperOption };

export function ScrapedSheetPrompt({
  exhausted,
  actors = [],
  scrapers = [],
}: {
  exhausted: boolean;
  actors?: LeadScrapeActorOption[];
  scrapers?: ZarScraperOption[];
}) {
  const outreach = useTaskRun();
  if (!exhausted && outreach.phase === "idle") return null;

  return (
    <section className="mb-8 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/90">Scraped sheet</p>
      <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg text-white">Old scraped data is done</h2>
      <p className="mt-2 max-w-2xl text-sm text-amber-50/90">
        This Google sheet batch was already imported and used. Need new scraped data? Run the website engine
        below (HTTP / Browser / Firecrawl), optionally Apify for lead lists, or keep the same people.
      </p>
      <div className="mt-4">
        <ScrapeNowControls scrapers={scrapers} actors={actors} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href="/integrations/sheets">Open sheet</Link>
        </Button>
        <Button
          variant="outline"
          disabled={outreach.pending}
          onClick={() =>
            outreach.run(async () => {
              const report = await runLiveOutreachAction({ reuseSheet: true });
              return summarizeLiveRun(report);
            })
          }
        >
          {outreach.pending ? "Running…" : "Use this sheet anyway"}
        </Button>
      </div>
      <TaskRunBanner phase={outreach.phase} lines={outreach.lines} />
    </section>
  );
}
