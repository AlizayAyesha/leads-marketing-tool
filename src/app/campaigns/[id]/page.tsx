import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { defaultCampaignBrief, parseCampaignIntent } from "@/lib/campaigns/intent";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { CampaignRunControls } from "@/components/campaigns/campaign-run-controls";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [campaign, actors] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id },
      include: {
        actors: { include: { actor: true } },
        runs: { orderBy: { createdAt: "desc" }, take: 8 },
        _count: { select: { leads: true } },
      },
    }),
    prisma.apifyActor.findMany({ where: { active: true }, orderBy: { displayName: "asc" } }),
  ]);
  if (!campaign) notFound();

  const brief = { ...defaultCampaignBrief(), ...parseCampaignIntent(campaign.filters) };

  return (
    <div>
      <PageHeader
        eyebrow="Campaign"
        title={campaign.name}
        description={campaign.description || "Run selected actors in parallel, then normalize into leads."}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="muted">{campaign.status}</Badge>
        <Badge>{campaign._count.leads} leads</Badge>
        {campaign.runAiAfterScrape ? <Badge>AI after scrape</Badge> : null}
        {brief.cities?.length ? <Badge>{brief.cities.join(" · ")}</Badge> : null}
      </div>

      <CampaignRunControls campaignId={campaign.id} />

      <div className="mt-8">
        <CampaignBuilder
          campaignId={campaign.id}
          initial={{
            name: campaign.name,
            description: campaign.description ?? "",
            actorIds: campaign.actors.map((item) => item.apifyActorId),
            runAiAfterScrape: campaign.runAiAfterScrape,
            sheetSpreadsheetId: campaign.sheetSpreadsheetId ?? "",
            sheetWorksheet: campaign.sheetWorksheet ?? "",
            targetCount: brief.targetCount ?? 10,
            cities: (brief.cities ?? []).join(", "),
            regions: (brief.regions ?? []).join(", "),
            companySizes: brief.companySizes ?? ["SMB", "LARGE"],
            needCriteria: brief.needCriteria ?? "",
          }}
          actors={actors.map((actor) => ({
            id: actor.id,
            label: actor.displayName,
            actorId: actor.actorId,
            platform: actor.platform,
          }))}
        />
      </div>

      <section className="mt-8 glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Runs</h2>
        {campaign.runs.length === 0 ? <p className="text-sm text-muted">No runs yet.</p> : null}
        <div className="space-y-2">
          {campaign.runs.map((run) => (
            <Link
              key={run.id}
              href={`/campaigns/${campaign.id}/runs/${run.id}`}
              className="flex justify-between gap-3 rounded-xl border border-white/5 px-3 py-3 text-sm hover:bg-white/3"
            >
              <span>
                {run.status} · {run.testMode ? "test" : "full"} · {run.newLeads} new / {run.leadsCollected} collected
              </span>
              <span className="text-muted">{formatDate(run.createdAt)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
