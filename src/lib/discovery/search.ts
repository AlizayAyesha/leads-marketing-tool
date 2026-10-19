import "server-only";

import { ingestLeads } from "@/lib/leads/ingest";
import { getBusinessPolicy } from "@/lib/config/business-store";
import { writeAudit } from "@/lib/db/settings";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { isChromeLinkedInSessionReady } from "@/lib/linkedin/session/host";
import { PdlClient } from "@/lib/pdl/client";
import { pdlDisplayName, normalizePdlLinkedInUrl } from "@/lib/pdl/map-person";
import { getPdlApiKey } from "@/lib/pdl/secrets";
import { countPdlDailyUsage } from "@/lib/pdl/usage";
import { buildPdlDiscoverySql } from "@/lib/discovery/query";
import { FirecrawlProvider } from "@/lib/scraping/providers/firecrawl";
import { isNonBuyerDiscoveryHost } from "@/lib/scraping/non-buyer-host";
import type { PdlPerson } from "@/lib/pdl/types";

const DUBAI_LUXURY_QUERIES = [
  { query: "Dubai private jet charter company", industry: "Private aviation" },
  { query: "Dubai yacht charter company", industry: "Yacht charter" },
  { query: "Dubai luxury real estate brokerage", industry: "Luxury real estate" },
];

function personToLead(person: PdlPerson) {
  const linkedinUrl = normalizePdlLinkedInUrl(person.linkedin_url);
  if (inspectLinkedInUrl(linkedinUrl).kind !== "person") return null;
  const name = pdlDisplayName(person);
  const company = person.job_company_name?.trim() || null;
  const website = person.job_company_website?.trim() || null;
  if (!name && !company && !website) return null;
  return {
    name,
    company,
    website,
    location: person.location_name ?? null,
    industry: person.industry ?? person.job_company_industry ?? null,
    linkedinUrl,
    source: "pdl_person_search",
    notes: person.job_title ? `PDL job title: ${person.job_title}` : null,
    sourceActor: "pdl",
    sourceUrl: linkedinUrl,
    rawPayload: {
      pdlId: person.id ?? null,
      job_title: person.job_title ?? null,
      job_title_role: person.job_title_role ?? null,
      job_title_levels: person.job_title_levels ?? [],
    },
  };
}

export async function discoverProspects(input: { limit?: number; dryRun?: boolean } = {}) {
  if (isChromeLinkedInSessionReady()) {
    const session = await import("@/lib/linkedin/session/discover").then((mod) =>
      mod.discoverProspectsViaLinkedInSession(input),
    );
    if (!session.ok) {
      return {
        ok: false as const,
        error: session.error,
        quota: await countPdlDailyUsage(),
        sql: session.query,
        stored: 0,
        duplicates: 0,
        leadIds: [] as string[],
        source: session.source,
      };
    }
    return {
      ok: true as const,
      error: null,
      quota: await countPdlDailyUsage(),
      sql: session.query,
      stored: session.stored,
      duplicates: session.duplicates,
      leadIds: session.leadIds,
      source: session.source,
    };
  }

  const key = await getPdlApiKey();
  if (!key.token) {
    return {
      ok: false as const,
      error:
        "Connect Jarvis Chrome and sign into LinkedIn to search prospects. People Data Labs is optional and not required.",
      quota: await countPdlDailyUsage(),
      sql: null as string | null,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
    };
  }

  const quota = await countPdlDailyUsage();
  const size = Math.max(1, Math.min(input.limit ?? quota.discoveriesRemaining, quota.discoveriesRemaining, 10));
  if (quota.discoveriesRemaining <= 0) {
    return {
      ok: false as const,
      error: "Daily PDL discovery cap reached. Licensed discovery daily cap is a ceiling, not a quota to fill.",
      quota,
      sql: null,
      stored: 0,
      duplicates: 0,
      leadIds: [],
    };
  }

  const policy = await getBusinessPolicy();
  const sql = buildPdlDiscoverySql(policy.icp);

  if (input.dryRun) {
    return {
      ok: true as const,
      error: null,
      quota,
      sql,
      dryRun: true,
      stored: 0,
      duplicates: 0,
      leadIds: [],
    };
  }

  const client = new PdlClient(key.token);
  const response = await client.searchPeople({ sql, size });
  if (response.httpStatus === 401 || response.httpStatus === 403) {
    return {
      ok: false as const,
      error: "People Data Labs rejected the API key.",
      quota,
      sql,
      stored: 0,
      duplicates: 0,
      leadIds: [],
    };
  }
  if (response.httpStatus === 429) {
    return {
      ok: false as const,
      error: "People Data Labs rate limit reached. Try later.",
      quota,
      sql,
      stored: 0,
      duplicates: 0,
      leadIds: [],
    };
  }
  if (response.httpStatus === 402) {
    return {
      ok: false as const,
      error: "People Data Labs credits are exhausted.",
      quota,
      sql,
      stored: 0,
      duplicates: 0,
      leadIds: [],
    };
  }
  if (response.httpStatus !== 200) {
    return {
      ok: false as const,
      error: response.body?.error?.message || `People Data Labs search failed (${response.httpStatus}).`,
      quota,
      sql,
      stored: 0,
      duplicates: 0,
      leadIds: [],
    };
  }

  const leads = (response.body?.data ?? []).map(personToLead).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const ingested = await ingestLeads({
    leads,
    sourceName: "pdl_person_search",
  });

  for (const leadId of ingested.storedIds) {
    await writeAudit({
      action: "pdl.person_search_ingest",
      entity: "lead",
      entityId: leadId,
      payload: { source: "pdl_person_search" },
    });
  }

  await writeAudit({
    action: "lead.discovered",
    entity: "pdl",
    payload: {
      requested: size,
      returned: leads.length,
      stored: ingested.stored,
      duplicates: ingested.duplicates,
    },
  });

  return {
    ok: true as const,
    error: null,
    quota: await countPdlDailyUsage(),
    sql,
    dryRun: false,
    stored: ingested.stored,
    duplicates: ingested.duplicates,
    leadIds: ingested.storedIds,
    publicLeadIds: ingested.leadIds,
  };
}

function titleToCompany(title: unknown, url: string) {
  const text = String(title ?? "").trim();
  if (text) return text.split(/[|•-]/)[0]?.trim() || text;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function discoverDubaiLuxuryBusinesses(input: { limit?: number; dryRun?: boolean } = {}) {
  const maxPerQuery = Math.max(1, Math.min(input.limit ?? 5, 10));
  const provider = new FirecrawlProvider();
  const leads: Parameters<typeof ingestLeads>[0]["leads"] = [];
  const seen = new Set<string>();

  for (const item of DUBAI_LUXURY_QUERIES) {
    const result = await provider.search({ query: item.query, maxRequests: maxPerQuery });
    for (const record of result.records) {
      if (seen.has(record.sourceUrl)) continue;
      seen.add(record.sourceUrl);
      if (isNonBuyerDiscoveryHost(record.sourceUrl)) continue;
      const fields = record.normalizedFields;
      leads.push({
        company: titleToCompany(fields.title, record.sourceUrl),
        website: record.sourceUrl,
        location: "Dubai, United Arab Emirates",
        industry: item.industry,
        source: "firecrawl_business_search",
        sourceActor: "firecrawl",
        sourceUrl: record.sourceUrl,
        notes: String(fields.description ?? fields.snippet ?? "").slice(0, 500),
        rawPayload: {
          query: item.query,
          category: item.industry,
          result: record.rawEvidence,
        },
      });
    }
  }

  if (input.dryRun) {
    return {
      ok: true as const,
      error: null,
      dryRun: true,
      stored: 0,
      duplicates: 0,
      leadIds: [] as string[],
      preview: leads.slice(0, 10).map((lead) => ({ company: lead.company, website: lead.website, industry: lead.industry })),
      source: "firecrawl_business_search",
    };
  }

  const ingested = await ingestLeads({ leads, sourceName: "firecrawl_business_search" });
  await writeAudit({
    action: "discover.firecrawl_business_search",
    entity: "firecrawl",
    payload: {
      queries: DUBAI_LUXURY_QUERIES.map((item) => item.query),
      returned: leads.length,
      stored: ingested.stored,
      duplicates: ingested.duplicates,
    },
  });

  return {
    ok: true as const,
    error: null,
    dryRun: false,
    stored: ingested.stored,
    duplicates: ingested.duplicates,
    leadIds: ingested.storedIds,
    publicLeadIds: ingested.leadIds,
    source: "firecrawl_business_search",
  };
}
