import { getAgentCenter } from "@/lib/queries";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/utils";
import { AGENT_CONTRACTS } from "@/lib/agents/contracts";
import { AGENT_LANES, laneForSlug } from "@/lib/agents/lanes";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { PromptEditor } from "@/components/agents/prompt-editor";

export const dynamic = "force-dynamic";

const LANE_COPY: Record<string, { title: string; detail: string }> = {
  revenueFiverr: {
    title: "Revenue-critical · Fiverr",
    detail: "Separate channel: import → market → gig experiment → qualify → draft → follow-up. Human approval before any send.",
  },
  revenueOutbound: {
    title: "Revenue-critical · Outbound",
    detail: "Lead pipeline. Production Gmail send still requires commercial ≥80.",
  },
  supporting: {
    title: "Supporting",
    detail: "Research tools and orchestration. Not a second acquisition swarm.",
  },
  future: {
    title: "Future · Upwork",
    detail: "Finish Fiverr as a measurable revenue engine before expanding Upwork.",
  },
  other: {
    title: "Other",
    detail: "Not yet assigned to a lane.",
  },
};

export default async function AgentsPage() {
  const [{ agents, recentRuns, queued }, prompts] = await Promise.all([
    getAgentCenter().catch(() => ({ agents: [], recentRuns: [], queued: [] })),
    prisma.prompt.findMany({ orderBy: { name: "asc" } }).catch(() => []),
  ]);

  const grouped = [...Object.keys(AGENT_LANES), "other"].map((lane) => ({
    lane,
    agents: agents.filter((agent) => laneForSlug(agent.slug) === lane),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Control center"
        title="Agents"
        description="Goal is not 19 agents running. Goal is Fiverr: opportunity → qualified → response → reply → order — while outbound stay locked at ≥80."
      />

      {grouped.map((group) =>
        group.agents.length === 0 ? null : (
          <section key={group.lane} className="mb-8">
            <h2 className="mb-1 font-[family-name:var(--font-syne)] text-lg">{LANE_COPY[group.lane]?.title}</h2>
            <p className="mb-3 text-xs text-muted">{LANE_COPY[group.lane]?.detail}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {group.agents.map((agent) => (
                <article key={agent.id} className="glass rounded-2xl p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium">{agent.name}</h3>
                    <Badge tone={agent.status === "ERROR" ? "HOT" : agent.status === "RUNNING" ? "WARM" : "default"}>
                      {agent.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">{agent.currentTask || "Idle"}</p>
                  <p className="mt-3 text-xs text-muted">
                    {agent.tasksDone} completed · {agent.errorCount} errors
                  </p>
                  <p className="mt-1 text-xs text-muted">Last run {formatDate(agent.lastRunAt)}</p>
                  {agent.lastError ? <p className="mt-2 text-xs text-rose-300">{agent.lastError}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ),
      )}

      <div className="mb-8 grid gap-3 md:grid-cols-2">
        {AGENT_CONTRACTS.map((contract) => (
          <article key={contract.slug} className="glass rounded-2xl p-4">
            <h2 className="text-sm font-medium">{contract.slug}</h2>
            <p className="mt-3 text-xs uppercase tracking-wider text-emerald-300/80">Can</p>
            <ul className="mt-1 space-y-1 text-xs text-emerald-100/90">
              {contract.can.map((item) => (
                <li key={item}>✓ {item}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs uppercase tracking-wider text-rose-300/80">Cannot</p>
            <ul className="mt-1 space-y-1 text-xs text-rose-100/80">
              {contract.cannot.map((item) => (
                <li key={item}>✗ {item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="mb-8 glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Queue</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {queued.length === 0 ? <p className="text-muted">No task rows yet.</p> : null}
          {queued.map((item) => (
            <Badge key={item.status} tone="muted">
              {item.status} · {item._count}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mb-8 glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Recent runs</h2>
        <div className="space-y-2 text-sm">
          {recentRuns.map((run) => (
            <div key={run.id} className="flex justify-between gap-4 border-b border-white/5 pb-2">
              <span>
                {run.agent.name} · {run.lead?.leadId ?? "system"} · {run.status}
              </span>
              <span className="text-muted">{formatDate(run.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>

      <h2 className="mb-4 font-[family-name:var(--font-syne)] text-2xl">Editable prompts</h2>
      <div className="space-y-4">
        {prompts.map((prompt) => (
          <PromptEditor key={prompt.id} agentSlug={prompt.agentSlug} name={prompt.name} content={prompt.content} />
        ))}
      </div>
    </div>
  );
}
