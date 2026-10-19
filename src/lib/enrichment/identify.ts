import "server-only";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { PdlClient } from "@/lib/pdl/client";
import { PDL_MIN_LIKELIHOOD } from "@/lib/pdl/constants";
import { getPdlApiKey } from "@/lib/pdl/secrets";
import { countPdlDailyUsage } from "@/lib/pdl/usage";
import { canIdentifyLead, decideLinkedInIdentifyWrite } from "@/lib/enrichment/identify-policy";

export type IdentifyLeadResult = {
  leadId: string;
  publicLeadId: string;
  wrote: boolean;
  url: string | null;
  reason: string;
};

export async function identifyMissingLinkedIn(input: {
  limit?: number;
  leadIds?: string[];
  dryRun?: boolean;
} = {}) {
  const key = await getPdlApiKey();
  if (!key.token) {
    return {
      ok: false as const,
      error: "People Data Labs is not configured. Add a PDL API key under Integrations → API Keys.",
      quota: await countPdlDailyUsage(),
      results: [] as IdentifyLeadResult[],
    };
  }

  const quota = await countPdlDailyUsage();
  const requested = Math.max(1, Math.min(input.limit ?? 8, quota.lookupsRemaining, 10));
  if (requested <= 0) {
    return {
      ok: false as const,
      error: "Daily PDL lookup cap reached. Licensed lookup daily cap is a ceiling.",
      quota,
      results: [] as IdentifyLeadResult[],
    };
  }

  const leads = await prisma.lead.findMany({
    where: {
      suppressed: false,
      status: { not: "DO_NOT_CONTACT" },
      ...(input.leadIds?.length ? { id: { in: input.leadIds } } : {}),
    },
    orderBy: { lastActivityAt: "desc" },
    take: 200,
  });

  const eligible = leads.filter((lead) => {
    if (inspectLinkedInUrl(lead.linkedinUrl).kind === "person") return false;
    return canIdentifyLead({
      name: lead.name,
      company: lead.company,
      email: lead.email,
      website: lead.website,
      location: lead.location,
      phone: lead.phone,
      twitterUrl: lead.twitterUrl,
    });
  }).slice(0, requested);

  if (input.dryRun) {
    return {
      ok: true as const,
      error: null,
      quota,
      dryRun: true,
      selected: eligible.length,
      results: eligible.map((lead) => ({
        leadId: lead.id,
        publicLeadId: lead.leadId,
        wrote: false,
        url: null,
        reason: "Dry run — no PDL call.",
      })),
    };
  }

  const client = new PdlClient(key.token);
  const results: IdentifyLeadResult[] = [];

  for (const lead of eligible) {
    const response = await client.enrichPerson({
      email: lead.email ?? undefined,
      name: lead.name ?? undefined,
      company: lead.company ?? lead.website ?? undefined,
      location: lead.location ?? undefined,
      phone: lead.phone ?? undefined,
      min_likelihood: PDL_MIN_LIKELIHOOD,
      required: "linkedin_url",
    });
    const decision = decideLinkedInIdentifyWrite({
      existingLinkedInUrl: lead.linkedinUrl,
      httpStatus: response.httpStatus === 200 ? response.body?.status ?? 200 : response.httpStatus,
      likelihood: response.body?.likelihood ?? null,
      linkedinUrl: response.body?.data?.linkedin_url ?? null,
    });
    const charged = response.httpStatus === 200 && response.body?.status === 200;
    if (charged) {
      await writeAudit({
        action: "pdl.person_enrich",
        entity: "lead",
        entityId: lead.id,
        payload: {
          purpose: "identify",
          likelihood: response.body?.likelihood ?? null,
          wrote: decision.write,
        },
      });
    }

    if (decision.write) {
      const person = response.body?.data;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          linkedinUrl: decision.url,
          lastActivityAt: new Date(),
          ...(lead.company || !person?.job_company_name ? {} : { company: person.job_company_name }),
          ...(lead.location || !person?.location_name ? {} : { location: person.location_name }),
          ...(lead.industry || !(person?.industry || person?.job_company_industry)
            ? {}
            : { industry: person.industry ?? person.job_company_industry }),
        },
      });
    }

    results.push({
      leadId: lead.id,
      publicLeadId: lead.leadId,
      wrote: decision.write,
      url: decision.write ? decision.url : null,
      reason: decision.reason,
    });
  }

  await writeAudit({
    action: "lead.linkedin_identified",
    entity: "pdl",
    payload: { selected: eligible.length, wrote: results.filter((item) => item.wrote).length },
  });

  return {
    ok: true as const,
    error: null,
    quota: await countPdlDailyUsage(),
    dryRun: false,
    selected: eligible.length,
    results,
  };
}
