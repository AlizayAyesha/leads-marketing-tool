import Link from "next/link";

import type { WorkforceFunnel } from "@/lib/workforce/types";

const STEPS: { key: "imported" | "valid" | "researched" | "opportunities" | "qualified" | "recommended" | "drafts" | "sent"; label: string }[] = [
  { key: "imported", label: "imported" },
  { key: "valid", label: "valid" },
  { key: "researched", label: "researched" },
  { key: "opportunities", label: "opportunities" },
  { key: "qualified", label: "qualified" },
  { key: "recommended", label: "recommended" },
  { key: "drafts", label: "drafts generated" },
  { key: "sent", label: "external messages sent" },
];

export function JobFunnelCard({ job }: { job: WorkforceFunnel }) {
  return (
    <article className="glass rounded-2xl p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">{job.jobId}</p>
      <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg">Workforce job</h2>
      <p className="mt-1 text-sm text-muted">{job.command}</p>
      <ol className="mt-4 space-y-1 text-sm">
        {STEPS.map((step) => (
          <li key={step.key} className="flex items-center justify-between border-b border-white/5 py-1.5">
            <span className="text-muted">{step.label}</span>
            <span className={step.key === "sent" ? "text-emerald-200" : "text-white"}>{job[step.key]}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-emerald-200">STATUS: {job.status}</p>
      {job.note ? <p className="mt-2 text-xs text-amber-200">{job.note}</p> : null}
      {job.leadIds.length ? (
        <p className="mt-3 text-xs text-muted">
          Strongest:{" "}
          {job.leadIds.slice(0, 8).map((id, index) => (
            <span key={id}>
              {index ? ", " : ""}
              <Link className="text-emerald-300" href={`/leads/${id}`}>
                {id}
              </Link>
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted">No stored leads yet. Import a sheet or CSV first.</p>
      )}
      {job.draftPreviews?.length ? (
        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-emerald-100">Drafts awaiting approval</h3>
            <Link className="text-xs text-emerald-300" href="/outreach">Review all</Link>
          </div>
          {job.draftPreviews.map((draft) => (
            <div key={draft.draftId} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link className="font-medium text-emerald-200" href={`/leads/${draft.leadId}`}>
                  {draft.company || draft.lead}
                </Link>
                <span className="text-xs text-amber-200">{draft.approvalStatus.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-2 text-xs text-muted">Business problem</p>
              <p>{draft.businessProblem || "No supported problem identified."}</p>
              <p className="mt-2 text-xs text-muted">
                Score {draft.qualificationScore ?? "—"} · {draft.recommendedService?.replaceAll("_", " ") ?? "No service"} · {draft.channel}
              </p>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-sans text-xs">{draft.draft}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
