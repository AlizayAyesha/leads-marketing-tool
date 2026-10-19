import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { OpportunityActions } from "@/components/freelance/opportunity-actions";
import { ProposalActions } from "@/components/freelance/proposal-actions";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await prisma.freelanceOpportunity.findUnique({
    where: { id },
    include: { proposals: { orderBy: { createdAt: "desc" } } },
  });
  if (!row) notFound();
  const reasons = Array.isArray(row.qualifyReasons) ? row.qualifyReasons.map(String) : [];
  const risks = Array.isArray(row.risks) ? row.risks.map(String) : [];

  return (
    <div>
      <PageHeader eyebrow={row.platform} title={row.title} description={row.clientName || "Client not provided"} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge>{row.status}</Badge>
        {row.classification ? <Badge tone={row.classification === "SKIP" ? "DISQUALIFIED" : "default"}>{row.classification}</Badge> : null}
        {row.fitScore != null ? <Badge>Score {row.fitScore}</Badge> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-3 font-[family-name:var(--font-syne)]">Listing</h2>
          <p className="text-sm text-muted">Budget: {row.budget || "not provided"}</p>
          {row.url ? (
            <a href={row.url} className="text-sm text-emerald-300 underline" target="_blank" rel="noreferrer">
              {row.url}
            </a>
          ) : null}
          <p className="mt-4 whitespace-pre-wrap text-sm">{row.description || "No description imported."}</p>
        </section>
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-3 font-[family-name:var(--font-syne)]">Qualification</h2>
          <ul className="space-y-2 text-sm">
            {reasons.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {risks.length ? (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-muted">Risks</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-100">
                {risks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-4 text-sm text-muted">{row.recommendedAction}</p>
        </section>
      </div>

      <div className="mt-6">
        <OpportunityActions opportunityId={row.id} />
      </div>

      <section className="mt-8 space-y-4">
        <h2 className="font-[family-name:var(--font-syne)] text-xl">Drafts awaiting humans</h2>
        {row.proposals.map((proposal) => (
          <article key={proposal.id} className="glass rounded-2xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm">{proposal.subject}</p>
              <Badge tone={proposal.status === "AWAITING_APPROVAL" ? "WARM" : "muted"}>{proposal.status}</Badge>
            </div>
            <ProposalActions proposalId={proposal.id} body={proposal.body} status={proposal.status} />
          </article>
        ))}
      </section>
    </div>
  );
}
