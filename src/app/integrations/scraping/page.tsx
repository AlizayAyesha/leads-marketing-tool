import { cancelScrapingAction, retryScrapingAction } from "@/lib/actions/scraping";
import { EliteEcosystemsPanel } from "@/components/elite/elite-ecosystems";
import { ScrapingStartForm } from "@/components/elite/scraping-start-form";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/page";
import { ClientOnly, TaskRunBanner } from "@/components/ui/task-run-status";

export const dynamic = "force-dynamic";

export default async function ScrapingControlCenter() {
  const [scrapers, jobs, evidenceCount, lastExperiment, lastSheetSync] = await Promise.all([
    prisma.scraperDefinition.findMany({ orderBy: [{ enabled: "desc" }, { name: "asc" }] }),
    prisma.scrapingJob.findMany({ take: 30, orderBy: { createdAt: "desc" }, include: { scraper: true } }),
    prisma.scrapedEvidence.count(),
    import("@/lib/elite/experiment").then((mod) => mod.getLatestEliteExperiment()).catch(() => null),
    import("@/lib/google/sync").then((mod) => mod.getLatestSheetSync()).catch(() => null),
  ]);
  const active = jobs.filter((job) => job.status === "QUEUED" || job.status === "RUNNING").length;
  const failed = jobs.filter((job) => job.status === "FAILED").length;
  const latest = jobs[0];
  const enabledScrapers = scrapers.filter((item) => item.enabled && ["crawlee", "playwright", "crawl4ai", "firecrawl"].includes(item.provider));

  return (
    <div>
      <PageHeader
        eyebrow="Elite Lead Engine"
        title="Discover elite leads"
        description="Discovery and evidence only. Maps/keyword first, then public website engines, then Google Sheet. Does not research, draft, or send. Run Today's Outreach from Home when you want drafts."
      />
      <EliteEcosystemsPanel last={lastExperiment} />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard label="Active jobs" value={active} />
        <StatCard label="Evidence records" value={evidenceCount} />
        <StatCard label="Recent failures" value={failed} />
      </div>
      <ClientOnly>
        {lastSheetSync?.ok ? (
          <TaskRunBanner
            phase="done"
            lines={[
              lastSheetSync.message,
              lastSheetSync.url ? `Sheet: ${lastSheetSync.url}` : "Leads tab updated.",
              "New companies were added. Already-sent people are marked SENT. Nothing new was sent.",
            ]}
          />
        ) : lastSheetSync && !lastSheetSync.ok ? (
          <TaskRunBanner phase="failed" lines={[lastSheetSync.message]} />
        ) : latest?.status === "RUNNING" || latest?.status === "QUEUED" ? (
          <TaskRunBanner phase="running" />
        ) : latest?.status === "FAILED" ? (
          <TaskRunBanner phase="failed" lines={[latest.error || `${latest.scraper.name} failed.`]} />
        ) : null}
      </ClientOnly>
      <ScrapingStartForm scrapers={enabledScrapers} />
      <div className="space-y-3">
        {jobs.map((job) => (
          <div key={job.id} className="glass flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <strong>{job.scraper.name}</strong>
                <Badge tone={job.status === "COMPLETED" ? "default" : "muted"}>
                  {job.status === "COMPLETED" ? "Done ✓" : job.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                {job.provider} · {job.operation} · found {job.recordsFound} · stored {job.recordsStored}
              </p>
              {job.error ? <p className="mt-1 text-xs text-rose-300">{job.error}</p> : null}
            </div>
            <div className="flex gap-2">
              {job.status === "QUEUED" || job.status === "RUNNING" ? (
                <form action={cancelScrapingAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <Button type="submit" variant="outline">
                    Cancel
                  </Button>
                </form>
              ) : null}
              {job.status === "FAILED" ? (
                <form action={retryScrapingAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <Button type="submit" variant="outline">
                    Retry
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
