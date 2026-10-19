import { integrationStatus } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { listDataSources } from "@/lib/data-sources";
import { addSuppression, saveBusinessPolicyAction } from "@/lib/actions/settings";
import { getBusinessPolicy } from "@/lib/config/business-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { GoogleSheetsPanel } from "@/components/settings/google-panel";
import { OpenAICredentialsPanel } from "@/components/settings/openai-credentials-panel";
import { getCredentialPolicy, listPublicCredentials } from "@/lib/ai/credentials";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const integrations = integrationStatus();
  const [connection, source, suppressions, policy, openaiCredentials, openaiPolicy, leadCount] = await Promise.all([
    prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.leadSource.findFirst({ where: { type: "GOOGLE_SHEETS" } }).catch(() => null),
    prisma.suppression.findMany({ orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
    getBusinessPolicy().catch(() => null),
    listPublicCredentials().catch(() => []),
    getCredentialPolicy().catch(() => ({
      policy: "ROUND_ROBIN" as const,
      failover: true,
      roundRobinIndex: 0,
    })),
    prisma.lead.count().catch(() => 0),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Integrations and safety"
        description="Secrets stay on the server. Unconfigured adapters are marked pending — they are not mocked as live."
      />

      <section className="mb-8 grid gap-3 md:grid-cols-2">
        {Object.values(integrations).map((item) => (
          <article key={item.label} className="glass rounded-2xl p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-syne)]">{item.label}</h2>
              <Badge tone={item.configured ? "default" : "muted"}>
                {item.configured ? "configured" : "pending"}
              </Badge>
            </div>
            <p className="text-sm text-muted">{item.detail}</p>
          </article>
        ))}
      </section>

      <div className="mb-8">
        <OpenAICredentialsPanel credentials={openaiCredentials} policy={openaiPolicy} />
      </div>

      {policy ? (
        <section className="mb-8 glass rounded-2xl p-5">
          <h2 className="mb-2 font-[family-name:var(--font-syne)] text-lg">Business policy</h2>
          <p className="mb-4 text-sm text-muted">
            ICP and scoring weights are configuration, not code. Empty ICP lists do not exclude anyone.
          </p>
          <form action={saveBusinessPolicyAction} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="industries">Target industries (comma)</Label>
              <Input id="industries" name="industries" defaultValue={policy.icp.industries.join(", ")} />
            </div>
            <div>
              <Label htmlFor="geographies">Geographies (comma)</Label>
              <Input id="geographies" name="geographies" defaultValue={policy.icp.geographies.join(", ")} />
            </div>
            <div>
              <Label htmlFor="jobTitles">Buyer titles for discovery (comma)</Label>
              <Input id="jobTitles" name="jobTitles" defaultValue={(policy.icp.jobTitles ?? []).join(", ")} />
            </div>
            <div>
              <Label htmlFor="companySize">Company size</Label>
              <Input id="companySize" name="companySize" defaultValue={policy.icp.companySize} />
            </div>
            <div>
              <Label htmlFor="icpNotes">ICP notes</Label>
              <Input id="icpNotes" name="icpNotes" defaultValue={policy.icp.notes} />
            </div>
            {(["fit", "need", "intent", "timing", "accessibility"] as const).map((key) => (
              <div key={key}>
                <Label htmlFor={key}>Score weight: {key}</Label>
                <Input id={key} name={key} type="number" defaultValue={policy.scoring[key]} />
              </div>
            ))}
            <Button type="submit" className="self-end">
              Save policy
            </Button>
          </form>
        </section>
      ) : null}

      <GoogleSheetsPanel
        configured={integrations.google.configured}
        email={connection?.googleEmail ?? null}
        sourceName={source?.name ?? null}
        spreadsheetId={
          source?.config && typeof source.config === "object"
            ? String((source.config as { spreadsheetId?: string }).spreadsheetId ?? "")
            : null
        }
        leadCount={leadCount}
      />

      <section className="mb-8 glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Data sources</h2>
        <div className="space-y-2 text-sm">
          {listDataSources().map((sourceItem) => (
            <div key={sourceItem.id} className="flex items-center justify-between">
              <span>
                {sourceItem.id} · phase {sourceItem.phase}
              </span>
              <Badge tone={sourceItem.configured ? "default" : "muted"}>
                {sourceItem.configured ? "ready" : "pending"}
              </Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Suppression list</h2>
        <form action={addSuppression} className="mb-4 grid gap-3 md:grid-cols-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" />
          </div>
          <div>
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" name="domain" />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
          <Button type="submit" className="self-end">
            Add
          </Button>
        </form>
        <div className="space-y-2 text-sm">
          {suppressions.map((row) => (
            <p key={row.id} className="text-muted">
              {row.email || row.domain || row.phone}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
