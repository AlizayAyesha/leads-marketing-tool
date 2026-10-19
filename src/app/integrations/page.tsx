import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { integrationStatus } from "@/lib/env";
import { apifyTokenPublicStatus } from "@/lib/secrets";
import { pdlTokenPublicStatus } from "@/lib/pdl/secrets";
import { openaiStatusSummary } from "@/lib/ai/credentials";
import { getChromeSession } from "@/lib/tools/chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const env = integrationStatus();
  const apify = await apifyTokenPublicStatus();
  const pdl = await pdlTokenPublicStatus().catch(() => ({ configured: false, source: null, hint: null }));
  const chrome = getChromeSession();
  const openai = await openaiStatusSummary().catch(() => null);
  const [actorCount, lastRun, google, integration] = await Promise.all([
    prisma.apifyActor.count().catch(() => 0),
    prisma.actorRun.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.integration.findUnique({ where: { kind: "APIFY" } }).catch(() => null),
  ]);

  const cards = [
    {
      title: "Elite Lead Engine",
      href: "/integrations/scraping",
      status: "connected",
      detail: "Discover companies into Google Sheets. Acquisition layer only — no research, drafts, or send.",
    },
    {
      title: "Apify",
      href: "/integrations/actors",
      status:
        integration?.health === "CONNECTED"
          ? "connected"
          : apify.configured
            ? "ready"
            : "pending",
      detail:
        integration?.health === "CONNECTED"
          ? `${actorCount} registered actors${apify.hint ? ` · ${apify.hint}` : ""}`
          : apify.configured
            ? `${actorCount} actors registered. Verify account before claiming CONNECTED.`
            : "Connect a token, then add any Actor ID.",
    },
    {
      title: "People Data Labs",
      href: "/integrations/keys",
      status: pdl.configured ? "connected" : "pending",
      detail: pdl.configured
        ? `Licensed person enrichment/search ${pdl.hint ?? ""}`.trim()
        : "Add a PDL API key. Jarvis will not log into LinkedIn.",
    },
    {
      title: "LinkedIn send",
      href: "/integrations/linkedin",
      status: chrome.status === "CONNECTED" ? "connected" : "pending",
      detail:
        chrome.status === "CONNECTED"
          ? "Jarvis Chrome session ready for LinkedIn account actions."
          : "Connect Jarvis Chrome and sign into LinkedIn. Agent-Reach is research only.",
    },
    {
      title: "Google Sheets",
      href: "/integrations/sheets",
      status: env.google.configured && google ? "connected" : env.google.configured ? "ready" : "pending",
      detail: google?.googleEmail || env.google.detail,
    },
    {
      title: "OpenAI",
      href: "/integrations/ai",
      status: openai?.configured ? "connected" : "heuristic",
      detail: openai
        ? `${openai.enabled} enabled · ${openai.policy}${openai.failover ? " · failover on" : ""}`
        : env.openai.detail,
    },
    {
      title: "Jarvis Chrome",
      href: "/integrations/browser",
      status: chrome.status === "CONNECTED" ? "connected" : "pending",
      detail:
        chrome.status === "CONNECTED"
          ? `Chrome session: ${chrome.profile}. LinkedIn account actions use this session.`
          : "Connect Jarvis Chrome. It opens its own window, then LinkedIn. Everyday Chrome is not used.",
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Integrations center"
        title="Connect sources, not scrapers"
        description="Register any compatible Apify Actor. Jarvis normalizes output into standard leads. PostgreSQL stays the source of truth. For Gmail + LinkedIn together, use Connect Google + LinkedIn on Home — it does not send or turn Daily ON."
        actions={
          <Button asChild>
            <Link href="/integrations/actors/new">Add Actor</Link>
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Link key={card.title} href={card.href} className="glass rounded-2xl p-5 hover:border-emerald-400/30">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-syne)] text-xl">{card.title}</h2>
              <Badge tone={card.status === "connected" ? "default" : "muted"}>{card.status}</Badge>
            </div>
            <p className="text-sm text-muted">{card.detail}</p>
          </Link>
        ))}
      </div>
      {lastRun ? (
        <p className="mt-6 text-xs text-muted">
          Last actor run {lastRun.status.toLowerCase()} · {lastRun.externalRunId || lastRun.id}
        </p>
      ) : null}
    </div>
  );
}
