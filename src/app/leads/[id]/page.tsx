import Link from "next/link";
import { notFound } from "next/navigation";

import { getLeadFile } from "@/lib/queries";
import { CHANNEL_LABEL, SERVICE_LABEL } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { markDoNotContact } from "@/lib/actions/leads";
import { runAgentOnLeadAction, runPipelineNowAction } from "@/lib/actions/pipeline";
import { markContacted } from "@/lib/actions/outreach";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { QualificationPanel } from "@/components/leads/qualification-panel";
import { DecisionPanel } from "@/components/leads/decision-panel";
import { ReplyIngestForm } from "@/components/leads/reply-ingest";
import { LinkedInConnectionPanel } from "@/components/leads/connection-panel";
import { ConversationPanel } from "@/components/leads/conversation-panel";
import { isPostConnectionMessageDue } from "@/lib/linkedin/connection/machine";
import type { LinkedInConnectionStatus } from "@/lib/linkedin/connection/types";
import { CommercialBriefPanel } from "@/components/leads/commercial-brief-panel";
import { parseBriefFromEvidenceItems, parseStoredCommercialBrief } from "@/lib/intelligence/brief-parse";
import type { EvidenceFinding } from "@/types";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadFile(id).catch(() => null);
  if (!lead) notFound();

  const research = lead.research[0];
  const score = lead.scores[0];
  const audit = lead.audits[0];
  const opportunity = lead.opportunities[0];
  const draft = lead.drafts[0];
  const sequence = lead.sequences[0];
  const findings = (research?.findings ?? []) as EvidenceFinding[];
  const brief =
    parseStoredCommercialBrief(score?.breakdown) ?? parseBriefFromEvidenceItems(opportunity?.evidenceItems);

  return (
    <div>
      <PageHeader
        eyebrow={lead.leadId}
        title={lead.company || lead.name || lead.leadId}
        description={[lead.industry, lead.location, lead.source].filter(Boolean).join(" · ")}
        actions={
          <>
            <form action={runPipelineNowAction.bind(null, lead.id)}>
              <Button type="submit">Run full pipeline</Button>
            </form>
            <form action={runAgentOnLeadAction.bind(null, lead.id, "RESEARCH_LEAD")}>
              <Button type="submit" variant="outline">
                Research
              </Button>
            </form>
            <form action={runAgentOnLeadAction.bind(null, lead.id, "QUALIFY_LEAD")}>
              <Button type="submit" variant="outline">
                Qualify
              </Button>
            </form>
            <form action={runAgentOnLeadAction.bind(null, lead.id, "AUDIT_LEAD")}>
              <Button type="submit" variant="outline">
                Decision maker
              </Button>
            </form>
            <form action={markDoNotContact.bind(null, lead.id)}>
              <Button type="submit" variant="danger">
                Do not contact
              </Button>
            </form>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="muted">{lead.status}</Badge>
        {lead.temperature ? <Badge tone={lead.temperature}>{lead.temperature}</Badge> : null}
        {opportunity?.selection ? (
          <Badge
            tone={
              opportunity.selection === "PRIORITY"
                ? "HOT"
                : opportunity.selection === "NURTURE"
                  ? "WARM"
                  : "DISQUALIFIED"
            }
          >
            {opportunity.selection}
          </Badge>
        ) : null}
        {score ? <Badge>BUY_NOW {typeof (score.breakdown as { buyNowScore?: number })?.buyNowScore === "number" ? (score.breakdown as { buyNowScore: number }).buyNowScore : score.score}</Badge> : null}
        {audit ? <Badge tone={audit.verdict === "PASS" ? "default" : audit.verdict === "HOLD" ? "WARM" : "DISQUALIFIED"}>{audit.verdict}</Badge> : null}
        {lead.suppressed ? <Badge tone="DISQUALIFIED">Suppressed</Badge> : null}
        {lead.traces[0] ? <Badge tone="muted">trace {lead.traces[0].id.slice(0, 8)}</Badge> : null}
        {lead.signalSets[0] ? <Badge tone="muted">signals</Badge> : null}
        {lead.outcomes[0] ? <Badge tone="muted">outcome {lead.outcomes[0].status}</Badge> : null}
      </div>

      {brief ? <CommercialBriefPanel brief={brief} /> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-4 font-[family-name:var(--font-syne)] text-lg">Lead file</h2>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <Item label="Name" value={lead.name} />
            <Item label="Company" value={lead.company} />
            <Item label="Website" value={lead.website} href={lead.website} />
            <Item label="Email" value={lead.email} />
            <Item label="LinkedIn" value={lead.linkedinUrl} href={lead.linkedinUrl} />
            <Item label="Instagram" value={lead.instagramUrl} href={lead.instagramUrl} />
            <Item label="Facebook" value={lead.facebookUrl} href={lead.facebookUrl} />
            <Item label="X" value={lead.twitterUrl} href={lead.twitterUrl} />
            <Item label="Missing fields" value={(lead.missingFields as string[]).join(", ") || "None recorded"} />
          </dl>
          {lead.originalPost ? (
            <div className="mt-4 rounded-xl bg-black/30 p-3 text-sm">
              <p className="mb-1 text-xs uppercase tracking-wider text-muted">Original post</p>
              {lead.originalPost}
            </div>
          ) : null}
        </section>

        <section className="glass rounded-2xl p-5">
          {score ? (
            <QualificationPanel
              score={score.score}
              reason={score.reason}
              temperature={lead.temperature}
              breakdown={score.breakdown}
              evidenceUsed={score.evidenceUsed}
              mode={score.mode}
            />
          ) : (
            <>
              <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Qualification</h2>
              <p className="text-sm text-muted">Not scored yet.</p>
            </>
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          {audit ? (
            <DecisionPanel
              verdict={audit.verdict}
              professionalStatus={audit.professionalStatus}
              emailStatus={audit.emailStatus}
              linkedinStatus={audit.linkedinStatus}
              linkedinSeniority={audit.linkedinSeniority}
              instagramStatus={audit.instagramStatus}
              instagramPresence={audit.instagramPresence}
              serviceNeedStatus={audit.serviceNeedStatus}
              allowedChannels={audit.allowedChannels}
              summary={audit.summary}
              blockers={audit.blockers}
              unknowns={audit.unknowns}
              recommendedAction={audit.recommendedAction}
              checks={audit.checks}
              mode={audit.mode}
            />
          ) : (
            <>
              <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Decision maker</h2>
              <p className="text-sm text-muted">
                Not audited yet. This checks whether the email, LinkedIn, and Instagram look like a real professional — and whether they need your services if they are not.
              </p>
            </>
          )}
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Research evidence</h2>
          {research ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">{research.websiteQualityNotes}</p>
              {findings.map((finding, index) => (
                <article key={`${finding.finding}-${index}`} className="rounded-xl border border-white/5 p-3">
                  <p className="text-sm text-white">{finding.finding}</p>
                  <p className="mt-1 text-xs text-muted">{finding.reason}</p>
                  <p className="mt-2 text-xs text-emerald-200/80">
                    Evidence: {finding.evidence}
                    {finding.sourceUrl ? (
                      <>
                        {" · "}
                        <a className="underline" href={finding.sourceUrl} target="_blank" rel="noreferrer">
                          {finding.sourceUrl}
                        </a>
                      </>
                    ) : null}
                  </p>
                </article>
              ))}
              {Array.isArray(research.limitations) && research.limitations.length ? (
                <p className="text-xs text-amber-200">
                  Limitations: {(research.limitations as string[]).join(" ")}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">No research yet.</p>
          )}
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">LinkedIn research</h2>
          {lead.linkedinResearch[0] ? (
            <div className="space-y-2 text-sm">
              <p>
                Status: {lead.linkedinResearch[0].status} · {lead.linkedinResearch[0].code}
              </p>
              {lead.linkedinResearch[0].headline ? <p>Headline: {lead.linkedinResearch[0].headline}</p> : null}
              {lead.linkedinResearch[0].currentCompany ? <p>Company: {lead.linkedinResearch[0].currentCompany}</p> : null}
              {lead.linkedinResearch[0].roleTitle ? <p>Role: {lead.linkedinResearch[0].roleTitle}</p> : null}
              {lead.linkedinResearch[0].errorMessage ? (
                <p className="text-amber-200">{lead.linkedinResearch[0].errorMessage}</p>
              ) : null}
              <p className="text-xs text-muted">
                Retrieved {formatDate(lead.linkedinResearch[0].retrievedAt)}
                {lead.linkedinResearch[0].source ? ` · ${lead.linkedinResearch[0].source}` : ""}
                {lead.linkedinResearch[0].traceId ? ` · trace ${lead.linkedinResearch[0].traceId.slice(0, 8)}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">No LinkedIn research yet. A stored URL is not research.</p>
          )}
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">LinkedIn connection</h2>
          <LinkedInConnectionPanel
            leadId={lead.id}
            connection={lead.linkedinConnections[0] ? toConnectionView(lead.linkedinConnections[0]) : null}
            messageDue={isPostConnectionMessageDue({
              status: (lead.linkedinConnections[0]?.status ?? "NOT_REQUESTED") as LinkedInConnectionStatus,
              stopped: Boolean(lead.linkedinConnections[0]?.stoppedAt),
              nextEligibleMessageAt: lead.linkedinConnections[0]?.nextEligibleMessageAt ?? null,
            })}
          />
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Conversation</h2>
          <ConversationPanel
            stage={lead.conversations[0]?.stage}
            signal={lead.conversations[0]?.signal}
            problem={lead.conversations[0]?.problem}
            pitchAllowed={lead.conversations[0]?.pitchAllowed}
            summary={lead.conversations[0]?.summary}
            stopped={Boolean(lead.conversations[0]?.stoppedAt)}
            stopReason={lead.conversations[0]?.stopReason}
            analysis={lead.conversations[0]?.analysis}
            intentScore={lead.conversations[0]?.intentScore}
            heat={lead.conversations[0]?.heat}
            meetingSource={lead.conversations[0]?.meetingSource}
            meetingEntryUrl={lead.conversations[0]?.meetingEntryUrl}
            linkSentAt={lead.conversations[0]?.linkSentAt}
            ctaClickedAt={lead.conversations[0]?.ctaClickedAt}
            bookedAt={lead.conversations[0]?.bookedAt}
            suggestedMessage={
              lead.drafts.find(
                (item) =>
                  item.channel === "LINKEDIN" &&
                  (item.stepKind === "CONVERSATION_REPLY" || item.stepKind === "LINKEDIN_POST_CONNECTION") &&
                  (item.status === "PENDING_APPROVAL" || item.status === "EDITED" || item.status === "APPROVED"),
              )?.message ?? null
            }
          />
          <ReplyIngestForm
            leadId={lead.id}
            defaultChannel={lead.linkedinConnections[0]?.status === "CONNECTED" ? "LINKEDIN" : "EMAIL"}
          />
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-2">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Instagram research</h2>
          {lead.instagramResearch[0] ? (
            <div className="space-y-2 text-sm">
              <p>
                Status: {lead.instagramResearch[0].status} · {lead.instagramResearch[0].code}
              </p>
              {lead.instagramResearch[0].username ? <p>Username: {lead.instagramResearch[0].username}</p> : null}
              {lead.instagramResearch[0].displayName ? <p>Name: {lead.instagramResearch[0].displayName}</p> : null}
              {lead.instagramResearch[0].bio ? <p>Bio: {lead.instagramResearch[0].bio}</p> : null}
              {lead.instagramResearch[0].errorMessage ? (
                <p className="text-amber-200">{lead.instagramResearch[0].errorMessage}</p>
              ) : null}
              <p className="text-xs text-muted">
                Retrieved {formatDate(lead.instagramResearch[0].retrievedAt)}
                {lead.instagramResearch[0].source ? ` · ${lead.instagramResearch[0].source}` : ""}
                {lead.instagramResearch[0].traceId ? ` · trace ${lead.instagramResearch[0].traceId.slice(0, 8)}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">No Instagram research yet. A stored URL is not research.</p>
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Opportunity</h2>
          {opportunity ? (
            <div className="space-y-2 text-sm">
              <p>{opportunity.problem}</p>
              <p className="text-muted">Evidence: {opportunity.evidence}</p>
              <Badge>{SERVICE_LABEL[opportunity.recommendedService]}</Badge>
              <p className="text-muted">{opportunity.suggestedOffer}</p>
              <p className="text-xs text-muted">Next: {opportunity.nextStep}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">No opportunity mapped.</p>
          )}
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-syne)] text-lg">Outreach draft</h2>
            {draft ? <Badge tone="muted">{CHANNEL_LABEL[draft.channel]} · {draft.status}</Badge> : null}
          </div>
          {draft ? (
            <div>
              {audit && audit.verdict !== "PASS" ? (
                <p className="mb-3 text-sm text-amber-200">
                  Decision Maker {audit.verdict}. This lead is not eligible for outreach drafts or sequences.
                </p>
              ) : null}
              {draft.subject ? <p className="mb-2 text-sm text-emerald-100">{draft.subject}</p> : null}
              <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">{draft.message}</pre>
              <p className="mt-3 text-xs text-muted">{draft.reasonForContacting}</p>
              {lead.replies[0] ? (
                <p className="mt-3 text-sm">
                  Reply: {lead.replies[0].intent} — {lead.replies[0].summary}
                </p>
              ) : null}
              {lead.status === "APPROVED" && audit?.verdict === "PASS" ? (
                <form className="mt-4" action={markContacted.bind(null, lead.id)}>
                  <Button type="submit" variant="outline">
                    Record manual contact
                  </Button>
                </form>
              ) : null}
              <p className="mt-3 text-xs text-muted">
                Email send is behind the kill switch on{" "}
                <Link href="/outreach" className="text-emerald-300">
                  Outreach
                </Link>
                . LinkedIn/Instagram stay drafts.
              </p>
              <ReplyIngestForm leadId={lead.id} />
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted">No draft yet. Run the pipeline after research.</p>
              <ReplyIngestForm leadId={lead.id} />
            </div>
          )}
          {sequence ? (
            <p className="mt-3 text-xs text-muted">
              Sequence {sequence.status} · {sequence.channel} · step {sequence.currentStep + 1}/4
              {sequence.stopReason ? ` · stopped: ${sequence.stopReason}` : ""}
            </p>
          ) : null}
        </section>

        <section className="glass rounded-2xl p-5 xl:col-span-3">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Audit trail</h2>
          <div className="space-y-2 text-sm">
            {lead.agentRuns.map((run) => (
              <div key={run.id} className="flex justify-between gap-4 border-b border-white/5 pb-2">
                <span>
                  {run.agent.name} · {run.status}
                  {run.error ? ` — ${run.error}` : ""}
                </span>
                <span className="text-muted">{formatDate(run.createdAt)}</span>
              </div>
            ))}
            {lead.agentRuns.length === 0 ? <p className="text-muted">No agent runs yet.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toConnectionView(row: {
  status: string;
  recommendedAt: Date | null;
  requestApprovedAt: Date | null;
  connectionRequestedAt: Date | null;
  connectedAt: Date | null;
  declinedAt: Date | null;
  lastCheckedAt: Date | null;
  nextEligibleMessageAt: Date | null;
  waitDays: number;
  statusSource: string;
  statusCode: string | null;
  lastCheckResult: string | null;
  stoppedAt: Date | null;
  stopReason: string | null;
}) {
  return {
    status: row.status,
    recommendedAt: toIso(row.recommendedAt),
    requestApprovedAt: toIso(row.requestApprovedAt),
    connectionRequestedAt: toIso(row.connectionRequestedAt),
    connectedAt: toIso(row.connectedAt),
    declinedAt: toIso(row.declinedAt),
    lastCheckedAt: toIso(row.lastCheckedAt),
    nextEligibleMessageAt: toIso(row.nextEligibleMessageAt),
    waitDays: row.waitDays,
    statusSource: row.statusSource,
    statusCode: row.statusCode,
    lastCheckResult: row.lastCheckResult,
    stoppedAt: toIso(row.stoppedAt),
    stopReason: row.stopReason,
  };
}

function Item({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1">
        {href && value ? (
          <a href={href} className="text-emerald-200 underline" target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value || "—"
        )}
      </dd>
    </div>
  );
}
