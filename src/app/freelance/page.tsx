import type { ProposalLifecycle } from "@prisma/client";
import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { platformPerformance } from "@/lib/platforms/analytics";
import { listPlatformAgents } from "@/lib/platforms/registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/page";
import { FreelanceIntake } from "@/components/freelance/intake-forms";
import { FiverrPipelineActions } from "@/components/freelance/fiverr-pipeline";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function FreelancePage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string; status?: string }>;
}) {
  const filters = await searchParams;
  const platform = filters.platform?.toUpperCase();
  const requestedStatus = filters.status?.toUpperCase() as ProposalLifecycle | undefined;
  const proposalStatuses: ProposalLifecycle[] = [
    "DRAFT",
    "AWAITING_APPROVAL",
    "APPROVED",
    "SUBMITTED",
    "REPLIED",
    "WON",
    "LOST",
  ];
  const proposalStatus = requestedStatus && proposalStatuses.includes(requestedStatus) ? requestedStatus : undefined;
  const [opportunities, proposals, gigs, inquiries, performance, connections, awaiting] = await Promise.all([
    prisma.freelanceOpportunity.findMany({
      where: {
        platform: platform === "UPWORK" || platform === "FIVERR" ? platform : undefined,
      },
      orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
      take: 40,
    }),
    prisma.freelanceProposal.findMany({
      where: proposalStatus ? { status: proposalStatus } : undefined,
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { opportunity: true, inquiry: true },
    }),
    prisma.gigProfile.count(),
    prisma.buyerInquiry.count(),
    platformPerformance(),
    prisma.platformConnection.findMany(),
    prisma.freelanceProposal.count({ where: { status: "AWAITING_APPROVAL" } }),
  ]);
  const agents = listPlatformAgents();

  return (
    <div>
      <PageHeader
        eyebrow="Freelance command center"
        title="Freelance"
        description="Fiverr is a separate revenue channel (qualify then draft). Upwork stays future. Outbound send is not controlled from here."
        actions={
          <Button asChild variant="outline">
            <Link href="/freelance/gigs">Fiverr gigs</Link>
          </Button>
        }
      />
      <FiverrPipelineActions />

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { href: "/freelance", label: "All" },
          { href: "/freelance?platform=upwork", label: "Upwork" },
          { href: "/freelance?platform=fiverr", label: "Fiverr" },
        ].map((item) => (
          <Button key={item.href} asChild variant="outline" size="sm">
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Opportunities" value={opportunities.length} />
        <StatCard label="Awaiting approval" value={awaiting} />
        <StatCard label="Fiverr gigs" value={gigs} />
        <StatCard label="Buyer inquiries" value={inquiries} />
      </div>

      <FreelanceIntake />

      <section className="mb-8">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-xl">Opportunities</h2>
        {opportunities.length === 0 ? (
          <EmptyState
            title="No freelance opportunities stored"
            description="Official Upwork/Fiverr search is unavailable. Paste a listing or buyer inquiry below."
          />
        ) : (
          <div className="space-y-2">
            {opportunities.map((row, index) => (
              <Link
                key={row.id}
                href={`/freelance/${row.id}`}
                className="glass flex items-center justify-between rounded-2xl px-4 py-3"
              >
                <div>
                  <p className="text-sm text-white">
                    #{index + 1} {row.platform} · {row.title}
                  </p>
                  <p className="text-xs text-muted">
                    {row.clientName || "Unknown client"} · {row.status} · {formatDate(row.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {row.classification ? <Badge tone={row.classification === "SKIP" ? "DISQUALIFIED" : "default"}>{row.classification}</Badge> : null}
                  <span className="text-emerald-200">{row.fitScore ?? "—"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-xl">Proposals / responses</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {proposalStatuses.map((status) => (
            <Button key={status} asChild variant="outline" size="sm">
              <Link href={`/freelance?status=${status.toLowerCase()}${platform ? `&platform=${platform.toLowerCase()}` : ""}`}>
                {status.replaceAll("_", " ")}
              </Link>
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          {proposals.length === 0 ? <p className="text-sm text-muted">No drafts yet.</p> : null}
          {proposals.map((item) => (
            <article key={item.id} className="glass rounded-2xl p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {item.kind === "UPWORK_PROPOSAL" ? "Upwork proposal" : "Fiverr response"} ·{" "}
                  {item.opportunity?.title || item.inquiry?.buyerName || "Untitled"}
                </p>
                <Badge tone={item.status === "AWAITING_APPROVAL" ? "WARM" : "muted"}>{item.status}</Badge>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-zinc-300">{item.body.slice(0, 360)}</pre>
              {item.opportunityId ? (
                <Link href={`/freelance/${item.opportunityId}`} className="mt-2 inline-block text-xs text-emerald-300">
                  Open file
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-xl">Platform performance</h2>
        <p className="mb-3 text-sm text-muted">{performance.conclusion}</p>
        <div className="overflow-x-auto glass rounded-2xl">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
              <tr>
                {["Platform", "Opportunities", "Qualified", "Responses", "Wins", "Conversion"].map((header) => (
                  <th key={header} className="px-4 py-3">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {performance.rows.map((row) => (
                <tr key={row.platform} className="border-t border-white/5">
                  <td className="px-4 py-3">{row.platform}</td>
                  <td className="px-4 py-3">{row.opportunities}</td>
                  <td className="px-4 py-3">{row.qualified}</td>
                  <td className="px-4 py-3">{row.proposals}</td>
                  <td className="px-4 py-3">{row.won}</td>
                  <td className="px-4 py-3">{row.enoughData ? `${row.conversion.toFixed(0)}%` : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-xl">Agent activity</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {agents.map((agent) => (
            <article key={agent.id} className="glass rounded-2xl p-4">
              <p className="text-sm">{agent.name}</p>
              <p className="mt-1 text-xs text-muted">{agent.capabilities.join(", ")}</p>
              <Badge className="mt-2" tone="muted">
                {agent.id === "upwork_proposal" && awaiting ? `${awaiting} drafts waiting` : "Idle"}
              </Badge>
            </article>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">
          Connections:{" "}
          {connections.length
            ? connections.map((item) => `${item.platform} ${item.status}`).join(" · ")
            : "none — official APIs remain unavailable"}
        </p>
      </section>
    </div>
  );
}
