import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { inspectAgentReachLinkedInCapabilities } from "@/lib/agent-reach/capabilities";
import { prisma } from "@/lib/db/prisma";
import {
  LINKEDIN_CONNECTION_SENT_EVENT,
  LINKEDIN_MESSAGE_SENT_EVENT,
  LINKEDIN_TEST_CONNECTION_SENT_EVENT,
  LINKEDIN_TEST_MESSAGE_SENT_EVENT,
} from "@/lib/linkedin/daily/events";
import { LINKEDIN_CONNECTION_EVENTS } from "@/lib/linkedin/connection/types";
import { resolveLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import { LINKEDIN_SEND_UNAVAILABLE_REASON } from "@/lib/linkedin/send/types";
import { getChromeSession } from "@/lib/tools/chrome";

export const dynamic = "force-dynamic";

export default async function LinkedInSendIntegrationsPage() {
  const reach = inspectAgentReachLinkedInCapabilities();
  const chrome = getChromeSession();
  const send = await resolveLinkedInSendProvider();
  const chromeReady = chrome.status === "CONNECTED" && send.configured;
  const activity = await prisma.outreachEvent
    .findMany({
      where: {
        channel: "LINKEDIN",
        type: {
          in: [
            LINKEDIN_CONNECTION_SENT_EVENT,
            LINKEDIN_MESSAGE_SENT_EVENT,
            LINKEDIN_TEST_CONNECTION_SENT_EVENT,
            LINKEDIN_TEST_MESSAGE_SENT_EVENT,
            LINKEDIN_CONNECTION_EVENTS.CONNECTED,
            LINKEDIN_CONNECTION_EVENTS.REQUESTED,
            LINKEDIN_CONNECTION_EVENTS.SENT,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        createdAt: true,
        payload: true,
        lead: { select: { leadId: true, name: true, linkedinUrl: true } },
      },
    })
    .catch(() => []);

  return (
    <div>
      <PageHeader
        eyebrow="LinkedIn"
        title="Research and account actions"
        description="Agent-Reach is research/discovery. Jarvis operates your authenticated LinkedIn account through the connected Chrome session."
      />

      <article className="mb-4 glass rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-syne)]">Agent-Reach research</h2>
          <Badge tone={reach.cliInstalled ? "default" : "muted"}>
            {reach.cliInstalled ? "CLI present" : "not installed"}
          </Badge>
        </div>
        <p className="text-sm text-muted">{reach.note}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Search people: {reach.search ? "documented if MCP is configured" : "not available"}</li>
          <li>Public profile read: Jina Reader (login wall is not evidence)</li>
          <li>Company / jobs: {reach.companyResearch ? "documented if MCP is configured" : "not available"}</li>
          <li>Connection requests: no — account actions use Chrome</li>
          <li>Messages: no — account actions use Chrome</li>
        </ul>
      </article>

      <article className="mb-4 glass rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-syne)]">Jarvis Chrome LinkedIn session</h2>
          <Badge tone={chromeReady ? "HOT" : "muted"}>{chromeReady ? "ready" : "not ready"}</Badge>
        </div>
        <p className="text-sm text-muted">
          Chrome: {chrome.status}
          {chrome.profile ? ` · ${chrome.profile}` : ""}.{" "}
          {chromeReady
            ? "Jarvis can operate this signed-in LinkedIn session: connect, detect acceptance, message, and read replies."
            : LINKEDIN_SEND_UNAVAILABLE_REASON}{" "}
          <Link href="/integrations/browser" className="underline underline-offset-2">
            Connect Chrome
          </Link>
          . Jarvis opens its own Chrome window, then LinkedIn. Everyday Chrome is not used.
        </p>
        <p className="mt-3 text-sm text-muted">
          Daily Outreach ON, 10 connection / 10 message ceilings, Decision Maker, commercial relevance, DNC, and the
          global kill switch remain in place. Jarvis does not fill the quota. REQUESTED is not CONNECTED. A successful
          database record requires an actual Chrome/LinkedIn result.
        </p>
      </article>

      <article className="glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)]">Actual LinkedIn activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">No confirmed LinkedIn actions yet. Hypothetical counts are not shown.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {activity.map((row) => {
              const payload =
                row.payload && typeof row.payload === "object" ? (row.payload as { code?: string; reason?: string }) : {};
              return (
                <li key={row.id} className="border-b border-white/5 pb-2">
                  <span className="text-emerald-100">{row.type}</span>
                  <span className="text-muted">
                    {" "}
                    · {row.lead.name || row.lead.leadId} · {payload.code || "recorded"} ·{" "}
                    {row.createdAt.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <p className="mt-6 text-sm text-muted">
        CTA remains{" "}
        <Link href="/go/linkedin" className="underline underline-offset-2">
          /go/linkedin
        </Link>
        . Instagram remains draft-only. Prove the transport with the isolated test-contact check before turning Daily Outreach
        ON.
      </p>
    </div>
  );
}
