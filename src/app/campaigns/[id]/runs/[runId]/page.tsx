import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { CampaignMonitor } from "@/components/campaigns/campaign-monitor";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function CampaignRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const run = await prisma.campaignRun.findUnique({
    where: { id: runId },
    include: {
      campaign: true,
      actorRuns: { include: { actor: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!run || run.campaignId !== id) notFound();

  return (
    <div>
      <PageHeader
        eyebrow={run.campaign.name}
        title="Campaign monitor"
        description="Each actor reports independently. Jarvis polls Apify for live status, then normalizes finished datasets."
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={run.status === "RUNNING" ? "WARM" : "default"}>{run.status}</Badge>
        <Badge tone="muted">{run.testMode ? "test mode · max 5" : "full run"}</Badge>
      </div>
      <CampaignMonitor
        runId={run.id}
        initial={{
          status: run.status,
          leadsCollected: run.leadsCollected,
          duplicatesRemoved: run.duplicatesRemoved,
          newLeads: run.newLeads,
          errorCount: run.errorCount,
          actors: run.actorRuns.map((item) => ({
            id: item.id,
            name: item.actor.displayName,
            status: item.status,
            startedAt: item.startedAt?.toISOString() ?? null,
            completedAt: item.completedAt?.toISOString() ?? null,
            resultCount: item.resultCount,
            excludedCount: item.excludedCount,
            errorCount: item.errorCount,
            externalRunId: item.externalRunId,
            error: item.error,
          })),
        }}
      />
    </div>
  );
}
