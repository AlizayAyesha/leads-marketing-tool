import "server-only";

import { ingestLeads } from "@/lib/leads/ingest";
import { getBusinessPolicy } from "@/lib/config/business-store";
import { writeAudit } from "@/lib/db/settings";
import { chromeLinkedInSessionHost, isChromeLinkedInSessionReady } from "@/lib/linkedin/session/host";
import { inspectLinkedInPage } from "@/lib/linkedin/session/inspect";
import {
  linkedInPeopleSearchQuery,
  linkedInPeopleSearchUrl,
  parseAuthenticatedLinkedInProfile,
  uniquePersonProfileUrls,
} from "@/lib/linkedin/session/parse";

const DISCOVERY_CEILING = 10;

export async function discoverProspectsViaLinkedInSession(input: { limit?: number; dryRun?: boolean } = {}) {
  if (!isChromeLinkedInSessionReady()) {
    return {
      ok: false as const,
      source: "chrome-linkedin-session" as const,
      error: "Connect Jarvis Chrome and sign into LinkedIn to search prospects. PDL is not required.",
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      query: null as string | null,
    };
  }
  const policy = await getBusinessPolicy();
  const query = linkedInPeopleSearchQuery(policy.icp);
  const limit = Math.max(1, Math.min(input.limit ?? DISCOVERY_CEILING, DISCOVERY_CEILING));
  const host = chromeLinkedInSessionHost();
  const found = await host.runOnPage(async (page) => {
    await page.goto(linkedInPeopleSearchUrl(query));
    const inspected = await inspectLinkedInPage(page);
    if (inspected.state === "AUTH_REQUIRED") {
      return { authRequired: true as const, urls: [] as string[] };
    }
    const hrefs = await page.collectHrefs("/in/");
    return { authRequired: false as const, urls: uniquePersonProfileUrls(hrefs, limit) };
  });
  if (found.authRequired) {
    return {
      ok: false as const,
      source: "chrome-linkedin-session" as const,
      error: "LinkedIn login wall during people search. Sign into LinkedIn in the Chrome session.",
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      query,
    };
  }
  if (input.dryRun) {
    return {
      ok: true as const,
      source: "chrome-linkedin-session" as const,
      error: null,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      query,
      urls: found.urls,
      dryRun: true as const,
    };
  }

  const leads = [];
  for (const url of found.urls) {
    const observed = await host.runOnPage(async (page) => {
      await page.goto(url);
      const inspected = await inspectLinkedInPage(page);
      return parseAuthenticatedLinkedInProfile({
        url: page.url(),
        title: inspected.title,
        text: inspected.text,
      });
    });
    if (!observed.profile?.displayName) continue;
    leads.push({
      name: observed.profile.displayName,
      company: observed.profile.currentCompany,
      linkedinUrl: url,
      location: observed.profile.location,
      industry: observed.profile.industry,
      notes: observed.profile.headline ? `LinkedIn headline: ${observed.profile.headline}` : null,
      source: "linkedin_session_search",
      sourceActor: "chrome-linkedin-session",
      sourceUrl: url,
      rawPayload: {
        query,
        roleTitle: observed.profile.roleTitle,
        headline: observed.profile.headline,
      },
    });
  }

    const ingested = leads.length
    ? await ingestLeads({ leads, sourceName: "linkedin_session_search" })
    : { stored: 0, storedIds: [] as string[], duplicates: 0 };
  await writeAudit({
    action: "discover.linkedin_session",
    entity: "linkedin_session",
    payload: {
      query,
      found: found.urls.length,
      named: leads.length,
      stored: ingested.stored,
      duplicates: ingested.duplicates,
    },
  });
  return {
    ok: true as const,
    source: "chrome-linkedin-session" as const,
    error: null,
    stored: ingested.stored,
    duplicates: ingested.duplicates,
    leadIds: ingested.storedIds,
    query,
  };
}
