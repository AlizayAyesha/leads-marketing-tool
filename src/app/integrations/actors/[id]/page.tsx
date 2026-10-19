import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { schemaToFields, type InputFieldDef, type OutputMapping } from "@/lib/actors/mapping";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { ActorControls } from "@/components/integrations/actor-controls";
import { ActorRunSync } from "@/components/integrations/actor-run-sync";
import { ActorInputForm } from "@/components/integrations/actor-input-form";
import { ActorMappingForm } from "@/components/integrations/actor-mapping-form";

export const dynamic = "force-dynamic";

export default async function ActorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await prisma.apifyActor.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 8 } },
  });
  if (!actor) notFound();

  const schemaFields = schemaToFields(actor.inputSchema as Record<string, unknown>);
  const manualFields = (actor.manualFields as InputFieldDef[] | null) ?? [];
  const fields = schemaFields.length ? schemaFields : manualFields;

  return (
    <div>
      <PageHeader
        eyebrow={actor.actorId}
        title={actor.displayName}
        description={actor.description || "Configure input, map output, then test with a 5-result cap."}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={actor.active ? "default" : "muted"}>{actor.active ? "active" : "disabled"}</Badge>
        {actor.platform ? <Badge tone="muted">{actor.platform}</Badge> : null}
        {actor.category ? <Badge tone="muted">{actor.category}</Badge> : null}
        {actor.sourceType ? <Badge tone="muted">{actor.sourceType}</Badge> : null}
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <Stat label="Last run" value={formatDate(actor.lastRunAt)} />
        <Stat label="Last success" value={formatDate(actor.lastSuccessAt)} />
        <Stat label="Total runs" value={actor.totalRuns} />
        <Stat label="Leads generated" value={actor.leadsGenerated} />
        <Stat label="Errors" value={actor.errorCount} />
        <Stat
          label="Avg duration"
          value={actor.avgDurationMs ? `${Math.round(actor.avgDurationMs / 1000)}s` : "—"}
        />
      </div>

      <ActorControls actorId={actor.id} active={actor.active} />

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <ActorInputForm
          actorId={actor.id}
          fields={fields}
          values={(actor.inputValues as Record<string, unknown>) ?? {}}
          schemaAvailable={schemaFields.length > 0}
        />
        <ActorMappingForm
          actorId={actor.id}
          mapping={(actor.outputMapping as OutputMapping) ?? {}}
        />
      </div>

      <section className="mt-8 glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Recent runs</h2>
        <div className="space-y-2 text-sm">
          {actor.runs.length === 0 ? <p className="text-muted">No runs yet.</p> : null}
          {actor.runs.map((run) => (
            <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-2">
              <span>
                {run.status} · {run.testMode ? "test" : "full"} · {run.resultCount} results · {run.ingestedNew} new ·{" "}
                {run.excludedCount} removed
                {run.externalRunId ? ` · ${run.externalRunId}` : ""}
              </span>
              <span className="flex flex-wrap items-center gap-3 text-muted">
                {["RUNNING", "STARTING", "QUEUED"].includes(run.status) ||
                (run.status === "SUCCEEDED" && !run.datasetImported && run.resultCount === 0 && run.ingestedNew === 0) ? (
                  <ActorRunSync runId={run.id} />
                ) : null}
                {formatDate(run.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-2 text-lg text-emerald-100">{value}</p>
    </div>
  );
}
