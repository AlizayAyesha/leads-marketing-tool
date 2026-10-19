import Link from "next/link";

import { TwitterDailyRunButtons } from "@/components/outreach/run-task-buttons";
import type { getTwitterDailyDashboard } from "@/lib/twitter/daily/dashboard";

function formatStamp(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function TwitterDailyPanel({
  dashboard,
}: {
  dashboard: Awaited<ReturnType<typeof getTwitterDailyDashboard>>;
}) {
  const { policy, confirmed, sendAvailable, unavailableReason, candidates, snapshot, auth } = dashboard;
  const enabled = policy.twitterDailyOutreach === true;
  const killSwitchOn = policy.sendsPaused;
  const canOperate = enabled && !killSwitchOn && sendAvailable;

  return (
    <section id="x-daily" className="mb-8 glass rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-400/80">X Daily Outreach</p>
          <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg">
            {enabled ? "X Outreach ON" : "X Outreach OFF"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Status and queue preview. Live X follow + DM send is on Home (≤10/wave). Cap {confirmed.cap}/day is a
            ceiling, not a quota.
          </p>
        </div>
        <TwitterDailyRunButtons enabled={enabled} canOperate={canOperate} />
      </div>

      <div className="mb-4 grid gap-3 text-sm md:grid-cols-4">
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs text-muted">Authorization</p>
          <p className="mt-1 font-medium text-white">{auth.code}</p>
          <p className="mt-1 text-xs text-muted">{auth.reason}</p>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs text-muted">DMs today</p>
          <p className="mt-1 font-medium text-white">
            {confirmed.dmsToday} / {confirmed.cap}
          </p>
          <p className="mt-1 text-xs text-muted">{confirmed.dmsRemaining} remaining</p>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs text-muted">Chrome / X</p>
          <p className="mt-1 font-medium text-white">{sendAvailable ? "ready" : "not ready"}</p>
          <p className="mt-1 text-xs text-muted">
            {unavailableReason ? (
              <>
                {unavailableReason}{" "}
                <Link href="/integrations/browser" className="underline">
                  Connect Chrome
                </Link>
              </>
            ) : (
              "Sign into x.com in the Jarvis Chrome window."
            )}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs text-muted">Queue</p>
          <p className="mt-1 font-medium text-white">{candidates.length} PASS candidates</p>
          <p className="mt-1 text-xs text-muted">
            Last run: {formatStamp(snapshot && typeof snapshot === "object" ? (snapshot as { at?: string }).at : null)}
          </p>
        </div>
      </div>

      {killSwitchOn ? (
        <p className="mb-3 text-sm text-amber-200/90">Kill switch is on — turn it off in the outreach engine panel.</p>
      ) : null}

      {candidates.length ? (
        <ul className="space-y-2 text-sm">
          {candidates.slice(0, 8).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 px-3 py-2">
              <div>
                <Link href={`/leads/${row.id}`} className="text-white underline-offset-2 hover:underline">
                  {row.name || row.leadId}
                </Link>
                <p className="text-xs text-muted">{row.twitterUrl}</p>
              </div>
              <span className="text-xs text-muted">{row.auditVerdict}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No PASS X leads queued. Discover X intent leads on Research first.</p>
      )}
    </section>
  );
}
