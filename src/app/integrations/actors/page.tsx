import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { apifyTokenPublicStatus } from "@/lib/secrets";
import { testApifyConnectionAction } from "@/lib/actions/integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ActorsPage() {
  const [apify, actors, integration] = await Promise.all([
    apifyTokenPublicStatus(),
    prisma.apifyActor.findMany({ orderBy: { updatedAt: "desc" } }).catch(() => []),
    prisma.integration.findUnique({ where: { kind: "APIFY" } }).catch(() => null),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Actor manager"
        title="Any compatible Actor"
        description="Register an Apify Actor ID. Jarvis does not ship hard-coded scrapers. Test runs cap results at 5."
        actions={
          <Button asChild>
            <Link href="/integrations/actors/new">Add Actor</Link>
          </Button>
        }
      />

      <section className="glass mb-8 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-[family-name:var(--font-syne)]">Apify connection</h2>
            <p className="mt-1 text-sm text-muted">
              {apify.configured
                ? `Token ${apify.source === "env" ? "from environment" : "from settings"} ${apify.hint}. Token never appears in prompts, logs, or the browser.`
                : "No token. Save one under API Keys or set APIFY_API_TOKEN."}
            </p>
            {integration?.publicConfig && typeof integration.publicConfig === "object" ? (
              <p className="mt-1 text-xs text-muted">
                {(integration.publicConfig as { username?: string }).username
                  ? `Account ${(integration.publicConfig as { username?: string }).username}`
                  : integration.lastError || "Not verified yet"}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={integration?.health === "CONNECTED" ? "HOT" : apify.configured ? "default" : "muted"}>
              {integration?.health === "CONNECTED"
                ? "CONNECTED"
                : apify.configured
                  ? "TOKEN PRESENT"
                  : "NOT CONNECTED"}
            </Badge>
            <form action={testApifyConnectionAction}>
              <Button type="submit" variant="outline" disabled={!apify.configured}>
                Verify account
              </Button>
            </form>
          </div>
        </div>
      </section>

      {actors.length === 0 ? (
        <EmptyState
          title="No actors registered"
          description="Add apify/google-maps-scraper or any other Actor ID you are licensed to run."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {actors.map((actor) => (
            <Link key={actor.id} href={`/integrations/actors/${actor.id}`} className="glass rounded-2xl p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-[family-name:var(--font-syne)] text-lg">{actor.displayName}</h2>
                <Badge tone={actor.active ? "default" : "muted"}>{actor.active ? "active" : "disabled"}</Badge>
              </div>
              <p className="text-xs text-emerald-200/80">{actor.actorId}</p>
              <p className="mt-2 text-sm text-muted">{actor.platform || "Unspecified platform"} · {actor.category || "Uncategorized"}</p>
              <p className="mt-3 text-xs text-muted">
                {actor.totalRuns} runs · {actor.leadsGenerated} leads · last {formatDate(actor.lastRunAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
