import { LinkedInDailyRunButtons } from "@/components/outreach/run-task-buttons";
import Link from "next/link";
import {
  LINKEDIN_CONNECTION_ELIGIBILITY_RULE,
  SOURCE_IS_NOT_ELIGIBILITY,
  type RankedLinkedInProspect,
} from "@/lib/linkedin/connection/ranking";
import type { getLinkedInDailyDashboard } from "@/lib/linkedin/daily/dashboard";

function formatStamp(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function LinkedInDailyPanel({
  dashboard,
  pendingConnections,
  pendingMessages,
  rankedConnections,
  rankedMessages,
}: {
  dashboard: Awaited<ReturnType<typeof getLinkedInDailyDashboard>>;
  pendingConnections: number;
  pendingMessages: number;
  rankedConnections: RankedLinkedInProspect[];
  rankedMessages: RankedLinkedInProspect[];
}) {
  const { policy, confirmed, sendAvailable, unavailableReason, snapshot, auth } = dashboard;
  const enabled = policy.linkedinDailyOutreach === true;
  const killSwitchOn = policy.sendsPaused;
  const canOperate = enabled && !killSwitchOn && sendAvailable;

  return (
    <section id="linkedin-daily" className="mb-8 glass rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-400/80">LinkedIn Daily Outreach</p>
          <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg">
            {enabled ? "🟢 LinkedIn Outreach ON" : "🔴 LinkedIn Outreach OFF"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Status and queue preview. Live send is on Home (≤10 connections / ≤10 messages per wave). REQUESTED is
            not CONNECTED.
          </p>
        </div>
        <LinkedInDailyRunButtons enabled={enabled} canOperate={canOperate} />
      </div>

      {killSwitchOn ? (
        <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          Global kill switch is ON. LinkedIn sending stays disabled even if Daily Outreach is ON.
        </p>
      ) : null}
      {!sendAvailable ? (
        <p className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {unavailableReason ?? "LinkedIn sending unavailable — connect an authorized sending provider."}{" "}
          <Link href="/integrations/linkedin" className="underline underline-offset-2">
            LinkedIn send status
          </Link>
        </p>
      ) : null}
      {enabled && !canOperate ? (
        <p className="mb-3 text-sm text-muted">{auth.reason}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Connections today" value={`${confirmed.connectionsToday} / ${confirmed.connectionCap}`} />
        <Stat label="Messages today" value={`${confirmed.messagesToday} / ${confirmed.messageCap}`} />
        <Stat label="Qualified prospects" value={dashboard.qualifiedConnections} />
        <Stat label="Connections pending" value={dashboard.pendingConnections} />
        <Stat label="Connected" value={dashboard.connected} />
        <Stat label="Meetings" value={dashboard.meetings} />
        <Stat label="Last run" value={formatStamp(snapshot.lastRunAt)} />
        <Stat label="Daily reset" value={formatStamp(dashboard.nextResetAt)} />
      </div>

      <p className="mt-4 text-sm text-muted">
        Next run: {formatStamp(snapshot.nextRunAt)}. Live path does not wait on draft approvals. Funnel: Discover → Enrich
        → Research → Qualify → Rank → Connection / Message.
        Connection → Connected → Conversation → Meeting. {SOURCE_IS_NOT_ELIGIBILITY} {LINKEDIN_CONNECTION_ELIGIBILITY_RULE}{" "}
        Approval queue: {pendingConnections} connection{pendingConnections === 1 ? "" : "s"} · {pendingMessages} message
        {pendingMessages === 1 ? "" : "s"}. Research continues from{" "}
        <Link href="/research" className="text-emerald-300 underline-offset-2 hover:underline">
          Research
        </Link>{" "}
        even when this switch is OFF.
      </p>

      {dashboard.errors.length ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-rose-100">Errors</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-100/90">
            {dashboard.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {dashboard.skipped.length ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-emerald-100">Skipped prospects</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {dashboard.skipped.slice(0, 8).map((row) => (
              <li key={`${row.leadId}-${row.kind}-${row.code}`}>
                {row.leadId}: {row.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RankedList
        title="Ranked connection prospects"
        empty="No eligible your business buyers. A LinkedIn URL from discovery is not enough."
        rows={rankedConnections}
      />
      <RankedList
        title="Ranked message prospects"
        empty="No authorized CONNECTED leads are message-eligible yet. REQUESTED and UNKNOWN are not CONNECTED."
        rows={rankedMessages}
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-lg text-emerald-100">{value}</p>
    </div>
  );
}

function RankedList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: RankedLinkedInProspect[];
}) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-medium text-emerald-100">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted">{empty}</p>
      ) : (
        <ol className="mt-2 space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2">
              <span>
                #{row.rank} {row.company || row.name || row.leadId}
                <span className="text-muted">
                  {" "}
                  · score {row.qualificationScore} · rank {row.rankScore} · {row.connectionStatus}
                </span>
              </span>
              <span className="text-xs text-muted">{row.reasons.join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
