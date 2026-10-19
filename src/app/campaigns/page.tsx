import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign
    .findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { leads: true, drafts: true, actors: true, runs: true } },
        runs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    })
    .catch(() => []);

  return (
    <div>
      <PageHeader
        eyebrow="Campaigns"
        title="Multi-actor acquisition"
        description="Select several registered Actors, run them in parallel, normalize into PostgreSQL, then optionally export Sheets and start AI analysis."
        actions={
          <Button asChild>
            <Link href="/campaigns/new">New campaign</Link>
          </Button>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create a campaign, attach Apify actors, and run a 5-result test before a full pull."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="glass rounded-2xl p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-syne)] text-lg">{campaign.name}</h2>
                <Badge tone="muted">{campaign.status}</Badge>
              </div>
              <p className="text-sm text-muted">{campaign.description || "No description"}</p>
              <p className="mt-3 text-xs text-muted">
                {campaign._count.actors} actors · {campaign._count.leads} leads · {campaign._count.runs} runs
                {campaign.runAiAfterScrape ? " · AI after scrape" : ""}
              </p>
              {campaign.runs[0] ? (
                <p className="mt-2 text-xs text-emerald-200/80">
                  Last run {campaign.runs[0].status} · {formatDate(campaign.runs[0].createdAt)}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
