import { operationalCapabilities } from "@/lib/capabilities/operational";
import { socialAutomationEnabled } from "@/lib/features";
import { integrationStatus } from "@/lib/env";
import { getOverviewMetrics, getLeadTable, getAgentCenter } from "@/lib/queries";
import { getSalesEvidenceBoard } from "@/lib/analytics/sales";
import { getSalesConversionFunnel } from "@/lib/conversation/funnel";
import { getLoopMetrics } from "@/lib/intelligence/metrics";
import { getIntelligenceDashboard } from "@/lib/analytics/intelligence-dashboard";
import { getLastWorkforceJob } from "@/lib/workforce/job";
import { isWorkforceFunnel } from "@/lib/workforce/types";
import { openaiStatusSummary } from "@/lib/ai/credentials";
import { getChromeSession } from "@/lib/tools/chrome";
import { connectionHasGmailSend } from "@/lib/outreach/send";
import { prisma } from "@/lib/db/prisma";
import { JobFunnelCard } from "@/components/jarvis/job-funnel";
import { HomeConnections } from "@/components/home/home-connections";
import { HomeDirectory } from "@/components/home/home-directory";
import { HomeOutreachControl } from "@/components/home/home-outreach-control";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui/page";
import Link from "next/link";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let metrics = null;
  let salesBoard = null;
  let loopMetrics = null;
  let leads: Awaited<ReturnType<typeof getLeadTable>> = [];
  let agents: Awaited<ReturnType<typeof getAgentCenter>>["agents"] = [];
  let lastJob = null;
  let salesFunnel = null;
  let intelligence = null;
  let dbError: string | null = null;

  try {
    [metrics, salesBoard, loopMetrics, leads, { agents }, lastJob] = await Promise.all([
      getOverviewMetrics(),
      getSalesEvidenceBoard(),
      getLoopMetrics(),
      getLeadTable(8),
      getAgentCenter(),
      getLastWorkforceJob(),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "Database is not reachable";
  }

  try {
    intelligence = await getIntelligenceDashboard();
  } catch {
    intelligence = null;
  }

  try {
    salesFunnel = await getSalesConversionFunnel();
  } catch {
    salesFunnel = null;
  }

  const socialAutomation = socialAutomationEnabled();
  const integrations = integrationStatus();
  const capabilities = await operationalCapabilities();
  const chrome = getChromeSession();
  const google = await prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null);
  const twitterDaily = await import("@/lib/twitter/daily/dashboard")
    .then((mod) => mod.getTwitterDailyDashboard())
    .catch(() => null);
  const sheetBatch = await import("@/lib/google/sheet-batch-store")
    .then((mod) => mod.getSheetBatchStatus())
    .catch(() => ({ exhausted: false }));
  const scrapeActors = await import("@/lib/actions/actors")
    .then((mod) => mod.listLeadScrapeActors())
    .catch(() => []);
  const scrapers = await import("@/lib/actions/scraping")
    .then((mod) => mod.listZarScrapers())
    .catch(() => []);
  const outreachPolicy = await import("@/lib/outreach/sequence")
    .then((mod) => mod.getOutreachEnginePolicy())
    .catch(() => null);
  const lastSheetSync = await import("@/lib/google/sync")
    .then((mod) => mod.getLatestSheetSync())
    .catch(() => null);
  const emailPulse = await import("@/lib/outreach/home-email-pulse")
    .then((mod) => mod.getHomeEmailPulse())
    .catch(() => null);
  const socialPulse = await import("@/lib/outreach/home-social-pulse")
    .then((mod) => mod.getHomeSocialPulse())
    .catch(() => null);

  return (
    <div>
      <PageHeader
        eyebrow="Home"
        title="Leads Marketing Tool"
        description={
          socialAutomation
            ? "Find buyers. Send from the four cards. Read ready counts and skip reasons."
            : "Find buyers. Send email from Home. Read ready counts and skip reasons."
        }
      />

      <HomeOutreachControl
        twitterDailyOn={twitterDaily?.policy.twitterDailyOutreach === true}
        twitterCanSend={
          twitterDaily?.policy.twitterDailyOutreach === true &&
          twitterDaily.policy.sendsPaused !== true &&
          twitterDaily.sendAvailable === true
        }
        chromeConnected={chrome.status === "CONNECTED"}
        sheetExhausted={sheetBatch.exhausted}
        scrapeActors={scrapeActors}
        scrapers={scrapers}
        lastLeadsWritten={lastSheetSync?.appended ?? 0}
        draftOnly={outreachPolicy?.sendMode === "draft_only"}
        killSwitchOn={outreachPolicy?.sendsPaused !== false}
        emailPulse={emailPulse}
        socialPulse={socialPulse}
        socialAutomation={socialAutomation}
        gmailSendReady={connectionHasGmailSend(google?.scopes)}
      />

      <HomeDirectory socialAutomation={socialAutomation} />

      <Suspense fallback={<section className="glass mb-8 rounded-2xl p-5 text-sm text-muted">Loading connections…</section>}>
        <HomeConnections
          chromeConnected={chrome.status === "CONNECTED"}
          chromeProfile={chrome.profile}
          googleEmail={google?.googleEmail ?? null}
          gmailSendReady={connectionHasGmailSend(google?.scopes)}
          socialAutomation={socialAutomation}
        />
      </Suspense>

      {dbError ? (
        <div className="glass mb-8 rounded-2xl border-amber-400/20 p-5 text-sm text-amber-100">
          PostgreSQL is not connected yet. Start Docker Postgres, copy `.env.example` to `.env.local`, then run{" "}
          `npm run setup`. {dbError}
        </div>
      ) : null}

      {intelligence ? (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-syne)] text-lg">Queue</h2>
            <Link href="/analytics" className="text-sm text-emerald-300">
              Full results
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Priority"
              value={intelligence.selection.priority}
              hint="Best to work next"
              href="/leads"
            />
            <StatCard label="Nurture" value={intelligence.selection.nurture} href="/leads" />
            <StatCard label="Reject" value={intelligence.selection.rejected} href="/leads" />
            <StatCard
              label="Meetings / 100"
              value={intelligence.northStar.meetingsPer100Researched}
              hint="North star"
              href="/analytics"
            />
          </div>
        </section>
      ) : null}

      <section className="mb-8 glass rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-syne)] text-lg">Recent leads</h2>
          <Link href="/leads" className="text-sm text-emerald-300">
            Open all
          </Link>
        </div>
        <div className="space-y-2">
          {leads.length === 0 ? (
            <p className="text-sm text-muted">No leads yet. Use Find leads on Home, or import a CSV.</p>
          ) : (
            leads.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center justify-between rounded-xl border border-white/5 px-3 py-3 hover:bg-white/3"
              >
                <div>
                  <p className="text-sm text-white">{lead.company || lead.name || lead.leadId}</p>
                  <p className="text-xs text-muted">
                    {lead.opportunities[0]?.selection ?? "unclassified"} · {lead.source || "unknown"} · {lead.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {lead.profileFitStatus === "KEPT" ? (
                    <Badge>Profile match {lead.profileFitScore ?? ""}</Badge>
                  ) : null}
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
                  ) : null}
                  {lead.temperature ? <Badge tone={lead.temperature}>{lead.temperature}</Badge> : null}
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      <details className="mb-8 rounded-2xl border border-white/10 bg-black/20 p-5">
        <summary className="cursor-pointer font-[family-name:var(--font-syne)] text-lg text-white">
          Details — outcomes, funnel, agents
        </summary>
        <div className="mt-5 space-y-8">
          {isWorkforceFunnel(lastJob) ? <JobFunnelCard job={lastJob} /> : null}

          {salesFunnel ? (
            <div>
              <h3 className="mb-3 text-sm text-muted">Sales today</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                <StatCard label="Connections" value={salesFunnel.today.connections} />
                <StatCard label="Accepted" value={salesFunnel.today.accepted} />
                <StatCard label="Conversations" value={salesFunnel.today.conversations} />
                <StatCard label="Problems" value={salesFunnel.today.problemsIdentified} />
                <StatCard label="Qualified" value={salesFunnel.today.qualifiedOpportunities} />
                <StatCard label="Pitches" value={salesFunnel.today.pitches} />
                <StatCard label="Meetings" value={salesFunnel.today.meetings} />
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 text-sm text-muted">Business outcomes</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Replies"
                value={salesBoard?.outcomes.replies.count ?? 0}
                href="/sales/replies"
              />
              <StatCard
                label="Opportunities"
                value={salesBoard?.outcomes.opportunities.count ?? 0}
                href="/sales/opportunities"
              />
              <StatCard
                label="Meetings"
                value={salesBoard?.outcomes.meetings.count ?? 0}
                href="/sales/meetings"
              />
              <StatCard
                label="Clients"
                value={salesBoard?.outcomes.clients.count ?? 0}
                href="/sales/clients"
              />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm text-muted">Activity</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Discovered" value={salesBoard?.activity.discovered ?? metrics?.total ?? "—"} />
              <StatCard label="Researched" value={salesBoard?.activity.researched ?? "—"} />
              <StatCard label="Connections" value={salesBoard?.activity.connectionsSent ?? "—"} />
              <StatCard label="Messages" value={salesBoard?.activity.messagesSent ?? "—"} />
              <StatCard label="Approval queue" value={metrics?.pendingDrafts ?? "—"} />
            </div>
          </div>

          {loopMetrics ? (
            <div className="text-sm text-muted">
              <p>
                PASS / HOLD / REJECT: {loopMetrics.qualification.pass} / {loopMetrics.qualification.hold} /{" "}
                {loopMetrics.qualification.reject}
              </p>
              <p className="mt-1">
                Drafts / approved / emailed: {loopMetrics.outreach.draftsCreated} /{" "}
                {loopMetrics.outreach.draftsApproved} / {loopMetrics.outreach.emailsSent}
              </p>
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 text-sm text-muted">What Jarvis can do</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {capabilities
                .filter((item) => socialAutomation || (item.id !== "linkedin_send" && item.id !== "browser"))
                .map((item) => (
                <article key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/5 px-3 py-2">
                  <div>
                    <p className="text-sm text-white">{item.name}</p>
                    <p className="text-xs text-muted">{item.detail}</p>
                  </div>
                  <Badge
                    tone={
                      item.state === "operational"
                        ? "HOT"
                        : item.state === "draft_only"
                          ? "WARM"
                          : item.state === "architecture_only"
                            ? "COLD"
                            : "muted"
                    }
                  >
                    {item.state.replaceAll("_", " ")}
                  </Badge>
                </article>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <OpenAIStatusCard />
            <div>
              <h3 className="mb-3 text-sm text-muted">Agents · Integrations</h3>
              <div className="space-y-2 text-sm">
                {agents.slice(0, 6).map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between">
                    <span>{agent.name.replace(" Agent", "")}</span>
                    <Badge tone={agent.status === "RUNNING" ? "HOT" : "default"}>{agent.status}</Badge>
                  </div>
                ))}
                {(integrations
                  ? Object.entries(integrations).filter(
                      ([key]) => socialAutomation || (key !== "linkedinSend" && key !== "linkedinConnectionStatus"),
                    )
                  : []
                ).map(([, item]) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span>{item.label}</span>
                    <Badge tone={item.configured ? "default" : "muted"}>
                      {item.configured ? "ready" : "pending"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

async function OpenAIStatusCard() {
  const summary = await openaiStatusSummary().catch(() => null);
  return (
    <div>
      <h3 className="mb-3 text-sm text-muted">OpenAI</h3>
      {summary ? (
        <div className="space-y-1 text-sm text-muted">
          <p>
            {summary.enabled} enabled · {summary.healthy} healthy
          </p>
          <p>Policy: {summary.policy}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Unavailable until Postgres is up.</p>
      )}
      <Link href="/settings/ai" className="mt-2 inline-block text-sm text-emerald-300">
        Manage
      </Link>
    </div>
  );
}
