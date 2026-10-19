"use client";

import { useState } from "react";

import { runAllZarScrapersAction, runZarScrapeAction } from "@/lib/actions/scraping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskRunBanner, useTaskRun } from "@/components/ui/task-run-status";

export function ScrapingStartForm({
  scrapers,
}: {
  scrapers: Array<{ id: string; slug: string; name: string }>;
}) {
  const task = useTaskRun();
  const [url, setUrl] = useState("");
  const [scraper, setScraper] = useState(scrapers[0]?.slug ?? "website-http");
  const [operation, setOperation] = useState<"scrape" | "crawl">("scrape");
  const [runAll, setRunAll] = useState(true);

  return (
    <div className="glass mb-6 rounded-2xl p-5">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <Input
          name="url"
          type="url"
          required
          placeholder="https://public-company-site.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={task.pending}
        />
        <select
          name="scraper"
          className="rounded-lg border border-emerald-500/20 bg-slate-950 px-3 text-sm"
          value={scraper}
          onChange={(event) => setScraper(event.target.value)}
          disabled={task.pending || runAll}
        >
          {scrapers.map((item) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          name="operation"
          className="rounded-lg border border-emerald-500/20 bg-slate-950 px-3 text-sm"
          value={operation}
          onChange={(event) => setOperation(event.target.value as "scrape" | "crawl")}
          disabled={task.pending}
        >
          <option value="scrape">One page</option>
          <option value="crawl">Same-site crawl</option>
        </select>
        <Button
          type="button"
          disabled={task.pending || !url.trim()}
          onClick={() =>
            task.run(async () => {
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
                  "Done only after sheet sync. Nothing new was sent.",
                ];
                if (result.status !== "COMPLETED") throw new Error(lines.join("\n"));
                return lines;
              }
              const result = await runZarScrapeAction({ url, scraper, operation });
              if (result.error) throw new Error(result.error);
              return [
                `${result.scraper} ${result.status}. Found ${result.recordsFound} · stored ${result.recordsStored}.`,
                result.sheet?.message ?? "Google Sheet updated.",
                "Done only after the Leads tab has new rows and SENT people marked. Nothing new was sent.",
              ];
            })
          }
        >
          {task.pending ? "Running…" : runAll ? "Run all" : "Start"}
        </Button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={runAll}
          onChange={(event) => setRunAll(event.target.checked)}
          disabled={task.pending}
        />
        Use all engines with retry: HTTP → Browser → Crawl4AI → Firecrawl
      </label>
      <TaskRunBanner phase={task.phase} lines={task.lines} />
    </div>
  );
}
