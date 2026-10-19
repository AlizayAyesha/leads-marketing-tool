"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import {
  discoverDubaiLuxuryAction,
  discoverProspectsAction,
  discoverTwitterIntentAction,
  enrichMissingLinkedInAction,
} from "@/lib/actions/discovery";
import { Button } from "@/components/ui/button";
import type { PdlDailyQuota } from "@/lib/pdl/quota";

export function DiscoveryPanel({
  pdlConfigured,
  chromeReady,
  apifyConfigured,
  firecrawlConfigured,
  quota,
}: {
  pdlConfigured: boolean;
  chromeReady: boolean;
  apifyConfigured: boolean;
  firecrawlConfigured: boolean;
  quota: PdlDailyQuota;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const canDiscover = chromeReady || pdlConfigured;

  return (
    <section className="mb-8 glass rounded-2xl p-5">
      <h2 className="font-[family-name:var(--font-syne)] text-lg">Discover → Enrich</h2>
      <p className="mt-1 text-sm text-muted">
        Jarvis searches LinkedIn through your authenticated Chrome session. X intent discovery uses Apify tweet search
        for people seeking your business services. Firecrawl search can discover company websites for verticals such as Dubai
        private aviation, yachts, and luxury real estate. Discovery identifies people or businesses; it does not make
        them eligible. Decision Maker PASS and a mapped opportunity are still required before outreach.
      </p>
      <p className="mt-3 text-sm">
        Chrome search: {chromeReady ? "ready" : "not connected"} · Apify (X): {apifyConfigured ? "ready" : "not connected"}{" "}
        · Firecrawl search: {firecrawlConfigured ? "ready" : "not configured"} · PDL lookups today: {quota.lookupsToday} /{" "}
        {quota.lookupCap} · PDL discoveries: {quota.discoveriesToday} / {quota.discoverCap}
      </p>
      {!chromeReady ? (
        <p className="mt-3 text-sm text-amber-200/90">
          <Link href="/integrations/browser" className="underline">
            Connect Jarvis Chrome
          </Link>{" "}
          and sign into LinkedIn to search prospects. PDL is optional.
        </p>
      ) : null}
      {!apifyConfigured ? (
        <p className="mt-3 text-sm text-amber-200/90">
          <Link href="/integrations/keys" className="underline">
            Save an Apify token
          </Link>{" "}
          to scrape X for buyers looking for your business services. No X login required for this path.
        </p>
      ) : null}
      {!firecrawlConfigured ? (
        <p className="mt-3 text-sm text-amber-200/90">
          Set <span className="font-mono">FIRECRAWL_API_KEY</span> to discover new Dubai jet, yacht, and luxury real
          estate companies without Apify Maps quota.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !canDiscover}
          onClick={() =>
            start(async () => {
              const result = await discoverProspectsAction();
              setMessage(
                result.ok
                  ? `Discovered ${result.stored} new prospects (${result.duplicates} duplicates). Pipeline queued.`
                  : result.error,
              );
            })
          }
        >
          Discover LinkedIn prospects
        </Button>
        <Button
          type="button"
          disabled={pending || !firecrawlConfigured}
          onClick={() =>
            start(async () => {
              const result = await discoverDubaiLuxuryAction();
              setMessage(
                result.ok
                  ? `Dubai search: stored ${result.stored} new businesses (${result.duplicates} duplicates). Pipeline queued.`
                  : result.error,
              );
            })
          }
        >
          Discover Dubai luxury businesses
        </Button>
        <Button
          type="button"
          disabled={pending || !apifyConfigured}
          onClick={() =>
            start(async () => {
              const result = await discoverTwitterIntentAction();
              const wrote = result.handoff?.enrich.wrote ?? 0;
              setMessage(
                result.ok
                  ? `X intent: kept ${result.kept}/${result.items} → stored ${result.stored}. LinkedIn enriched ${wrote}. Pipeline queued. Turn ON X Daily Outreach on Outreach to auto-DM (Jarvis Chrome + x.com signed in).`
                  : result.error,
              );
            })
          }
        >
          Discover X intent leads
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !pdlConfigured}
          onClick={() =>
            start(async () => {
              const result = await enrichMissingLinkedInAction();
              const wrote = result.results.filter((item) => item.wrote).length;
              setMessage(
                result.ok
                  ? `Looked up ${result.selected} leads. Wrote ${wrote} LinkedIn person URLs.`
                  : result.error,
              );
            })
          }
        >
          Enrich missing LinkedIn URLs
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
    </section>
  );
}
