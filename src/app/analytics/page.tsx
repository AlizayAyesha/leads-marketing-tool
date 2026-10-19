import { getIntelligenceDashboard } from "@/lib/analytics/intelligence-dashboard";
import { getFiverrChannelStats } from "@/lib/platforms/fiverr/analytics";
import { PageHeader, StatCard } from "@/components/ui/page";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  let board = null;
  let fiverr = null;
  let error: string | null = null;
  try {
    [board, fiverr] = await Promise.all([getIntelligenceDashboard(), getFiverrChannelStats()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Analytics could not load.";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="BD intelligence"
        description="North star is meetings (and later revenue) per 100 researched companies — not daily sends. Opens and clicks are not fabricated."
      />

      {error ? <p className="mb-6 text-sm text-red-300">{error}</p> : null}

      {board ? (
        <>
          <section className="mb-8">
            <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Opportunity selection</h2>
            <p className="mb-3 text-xs text-muted">PRIORITY is the work. NURTURE and REJECT stay off the send queue.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="PRIORITY" value={board.selection.priority} href="/leads" />
              <StatCard label="NURTURE" value={board.selection.nurture} href="/leads" />
              <StatCard label="REJECT" value={board.selection.rejected} href="/leads" />
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Today</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Researched" value={board.today.researched} />
              <StatCard label="Qualified (PASS)" value={board.today.qualifiedPass} hint="Quota PASSes still count here until re-audited" />
              <StatCard label="Sent" value={board.today.sent} />
              <StatCard label="Replies" value={board.today.replies} />
              <StatCard label="Positive" value={board.today.positive} />
              <StatCard label="Meetings" value={board.today.meetings} />
              <StatCard label="Awaiting approval" value={board.today.awaitingApproval} href="/outreach" />
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Funnel</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Leads" value={board.funnel.leads} />
              <StatCard label="Researched companies" value={board.funnel.researched} />
              <StatCard label="Qualified" value={board.funnel.qualified} />
              <StatCard label="Sent" value={board.funnel.sent} />
              <StatCard label="Replied" value={board.funnel.replied} />
              <StatCard label="Meetings" value={board.funnel.meetings} />
              <StatCard label="Won" value={board.funnel.won} />
              <StatCard
                label="Meetings / 100 researched"
                value={board.northStar.meetingsPer100Researched}
                hint="Primary KPI"
              />
            </div>
          </section>

          <section className="mb-8 grid gap-4 lg:grid-cols-2">
            <div className="glass rounded-2xl p-5">
              <h2 className="mb-2 font-[family-name:var(--font-syne)] text-lg">Engagement</h2>
              <p className="text-sm text-muted">{board.engagement.note}</p>
              <p className="mt-3 text-sm">Opens: {board.engagement.opens}</p>
              <p className="text-sm">Clicks: {board.engagement.clicks}</p>
            </div>
            <div className="glass rounded-2xl p-5">
              <h2 className="mb-2 font-[family-name:var(--font-syne)] text-lg">Needs attention</h2>
              <p className="text-sm">Pending drafts: {board.attention.pendingDrafts}</p>
              <p className="text-sm">Positive replies still open: {board.attention.unrepliedPositive}</p>
              <p className="text-sm">Sequence complete, no reply: {board.attention.sequencesCompletedNoReply}</p>
              <Link href="/outreach" className="mt-3 inline-block text-sm text-emerald-300">
                Open approval queue
              </Link>
            </div>
          </section>
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-syne)] text-lg">Fiverr (separate revenue channel)</h2>
              <Link href="/freelance?platform=fiverr" className="text-sm text-emerald-300">
                Open Fiverr
              </Link>
            </div>
            <p className="mb-4 text-xs text-muted">{fiverr?.note}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Opportunities researched" value={fiverr?.researched ?? "—"} />
              <StatCard label="Qualified (EXCELLENT/GOOD)" value={fiverr?.qualified ?? "—"} />
              <StatCard label="Rejected / skipped" value={fiverr?.rejected ?? "—"} />
              <StatCard label="Responses awaiting approval" value={fiverr?.awaiting ?? "—"} href="/freelance?status=awaiting_approval" />
              <StatCard label="Recorded submits" value={fiverr?.submitted ?? "—"} />
              <StatCard label="Buyer replies (marked)" value={fiverr?.replied ?? "—"} />
              <StatCard label="Orders (WON)" value={fiverr?.won ?? "—"} />
              <StatCard
                label="Avg order value"
                value={fiverr?.averageOrderValue ?? "—"}
                hint={fiverr?.revenue ? `Recorded budget sum $${fiverr.revenue}` : "No WON budgets yet"}
              />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
