import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { resolveAIConfig } from "@/lib/ai/config";
import { CONTENT_KINDS, CONTENT_PLATFORMS, contentKindLabel } from "@/lib/content/platforms";
import { ContentComposer } from "@/components/content/content-composer";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: initialLeadId } = await searchParams;
  const config = resolveAIConfig();
  const [leads, recent] = await Promise.all([
    prisma.lead
      .findMany({
        orderBy: { lastActivityAt: "desc" },
        take: 40,
        select: { id: true, name: true, company: true, leadId: true },
      })
      .catch(() => []),
    prisma.contentDraft
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { lead: { select: { id: true, name: true, company: true, leadId: true } } },
      })
      .catch(() => []),
  ]);

  const modelLine = config.apiKey
    ? `${config.label} · ${config.model}`
    : `${config.label} · ${config.model} (no key yet — drafts use the heuristic fallback)`;

  return (
    <div>
      <PageHeader
        eyebrow="Content Agent"
        title="Draft a post, comment, or DM"
        description="Pick a platform and a lead or a topic. The matching growth playbook is the system guidance. Drafts wait in Approvals. This app does not post or send them."
      />
      <p className="mb-6 text-sm text-muted">
        Model: {modelLine}. Paid OpenAI or OpenRouter keys stay optional. The default model is the free OpenRouter route.
      </p>
      <ContentComposer
        initialLeadId={initialLeadId}
        leads={leads.map((item) => ({
          id: item.id,
          label: item.company || item.name || item.leadId,
        }))}
      />
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-syne)] text-lg">Recent drafts</h2>
          <Link href="/outreach" className="text-sm text-emerald-300">
            Open Approvals
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No content drafts yet. A new one shows up here and in Approvals.</p>
        ) : (
          <div className="space-y-3">
            {recent.map((item) => {
              const platform = CONTENT_PLATFORMS.find((row) => row.id === item.platform)?.label ?? item.platform;
              const kind = CONTENT_KINDS.find((row) => row.id === item.kind);
              return (
                <article key={item.id} className="glass rounded-2xl p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge>{platform}</Badge>
                    <Badge tone="muted">{kind ? contentKindLabel(kind.id) : item.kind}</Badge>
                    <Badge tone={item.status === "APPROVED" ? "default" : "muted"}>{item.status.replaceAll("_", " ")}</Badge>
                    <span className="text-xs text-muted">
                      {item.lead ? item.lead.company || item.lead.name || item.lead.leadId : item.topic || "Topic"}
                      {item.modelProvider ? ` · ${item.modelProvider}` : item.mode === "heuristic" ? " · heuristic" : ""}
                    </span>
                  </div>
                  {item.subject ? <p className="mb-1 text-sm text-emerald-100">{item.subject}</p> : null}
                  <pre className="whitespace-pre-wrap font-sans text-sm">{item.message}</pre>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
