import Link from "next/link";

import { getResearchFeed } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/page";
import type { EvidenceFinding } from "@/types";
import { DiscoveryPanel } from "@/components/research/discovery-panel";
import { pdlTokenPublicStatus } from "@/lib/pdl/secrets";
import { countPdlDailyUsage } from "@/lib/pdl/usage";
import { pdlDailyQuota } from "@/lib/pdl/quota";
import { isChromeLinkedInSessionReady } from "@/lib/linkedin/session/host";
import { getApifyToken } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [rows, pdl, quota, apify] = await Promise.all([
    getResearchFeed().catch(() => []),
    pdlTokenPublicStatus().catch(() => ({ configured: false, source: null, hint: null })),
    countPdlDailyUsage().catch(() => pdlDailyQuota({ lookupsToday: 0, discoveriesToday: 0 })),
    getApifyToken().catch(() => ({ token: null as string | null })),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="AI research"
        title="Evidence first"
        description="Every finding is tied to a public URL or a field that already exists on the lead. Nothing is invented."
      />
      <DiscoveryPanel
        pdlConfigured={pdl.configured}
        chromeReady={isChromeLinkedInSessionReady()}
        apifyConfigured={Boolean(apify.token)}
        firecrawlConfigured={Boolean(process.env.FIRECRAWL_API_KEY?.trim())}
        quota={quota}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No research runs yet"
          description="Import leads, then run research from Lead Intelligence or ask Jarvis to research new leads."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const findings = (row.findings ?? []) as EvidenceFinding[];
            return (
              <article key={row.id} className="glass rounded-2xl p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/leads/${row.lead.id}`} className="font-[family-name:var(--font-syne)] text-lg">
                    {row.lead.company || row.lead.name || row.lead.leadId}
                  </Link>
                  <div className="flex gap-2">
                    <Badge tone="muted">{row.mode}</Badge>
                    {row.websiteQuality != null ? <Badge>Quality {row.websiteQuality}/10</Badge> : null}
                  </div>
                </div>
                <p className="mb-3 text-sm text-muted">{row.websiteQualityNotes}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {findings.slice(0, 6).map((finding, index) => (
                    <div key={index} className="rounded-xl bg-black/25 p-3 text-sm">
                      <p>{finding.finding}</p>
                      <p className="mt-1 text-xs text-muted">{finding.evidence}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">{formatDate(row.createdAt)}</p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
