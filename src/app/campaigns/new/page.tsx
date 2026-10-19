import { prisma } from "@/lib/db/prisma";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const actors = await prisma.apifyActor.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Campaign builder"
        title="Compose a multi-actor run"
        description="Actors execute independently. One failure does not stop the others. Sheets export is optional and never replaces Postgres."
      />
      <CampaignBuilder actors={actors.map(toOption)} />
    </div>
  );
}

function toOption(actor: { id: string; displayName: string; actorId: string; platform: string | null }) {
  return {
    id: actor.id,
    label: actor.displayName,
    actorId: actor.actorId,
    platform: actor.platform,
  };
}
