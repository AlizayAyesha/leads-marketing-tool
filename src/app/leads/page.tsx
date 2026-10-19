import Link from "next/link";

import { getLeadTable } from "@/lib/queries";
import { SERVICE_LABEL } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { LeadIntakeForms } from "@/components/leads/intake-forms";
import { researchNewLeadsAction } from "@/lib/actions/pipeline";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  let leads: Awaited<ReturnType<typeof getLeadTable>> = [];
  try {
    leads = await getLeadTable(200);
  } catch {
    leads = [];
  }

  return (
    <div>
      <PageHeader
        eyebrow="Lead intelligence"
        title="Every account in one file"
        description="Selection is PRIORITY, NURTURE, or REJECT. Score is not send-ready by itself."
        actions={
          <form action={researchNewLeadsAction}>
            <Button type="submit" variant="outline">
              Research new leads
            </Button>
          </form>
        }
      />
      <LeadIntakeForms />
      {leads.length === 0 ? (
        <EmptyState
          title="No leads in the system"
          description="Add a manual lead or import a CSV with Name, Company, Website, Email, and social URLs."
        />
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
                <tr className="border-b border-white/5">
                  {["Lead", "Company", "Source", "Score", "Fit", "Audit", "Status", "Selection", "Service", "Activity"].map(
                    (header) => (
                      <th key={header} className="px-4 py-3 font-medium">
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="text-emerald-200 hover:text-white">
                        {lead.name || lead.leadId}
                      </Link>
                      <p className="text-xs text-muted">{lead.leadId}</p>
                    </td>
                    <td className="px-4 py-3">{lead.company || "—"}</td>
                    <td className="px-4 py-3 text-muted">{lead.source || "—"}</td>
                    <td className="px-4 py-3">{lead.scores[0]?.score ?? "—"}</td>
                    <td className="px-4 py-3">
                      {lead.profileFitStatus === "KEPT" ? (
                        <Badge>Profile match {lead.profileFitScore ?? ""}</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.audits[0] ? (
                        <Badge
                          tone={
                            lead.audits[0].verdict === "PASS"
                              ? "default"
                              : lead.audits[0].verdict === "HOLD"
                                ? "WARM"
                                : "DISQUALIFIED"
                          }
                        >
                          {lead.audits[0].verdict}
                        </Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone="muted">{lead.status}</Badge>
                        {lead.temperature ? <Badge tone={lead.temperature}>{lead.temperature}</Badge> : null}
                      </div>
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-muted">
                      {lead.opportunities[0]?.selection ? (
                        <Badge
                          tone={
                            lead.opportunities[0].selection === "PRIORITY"
                              ? "HOT"
                              : lead.opportunities[0].selection === "NURTURE"
                                ? "WARM"
                                : "DISQUALIFIED"
                          }
                        >
                          {lead.opportunities[0].selection}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {lead.opportunities[0]
                        ? SERVICE_LABEL[lead.opportunities[0].recommendedService]
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(lead.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
