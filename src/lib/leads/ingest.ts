import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { createLeadId } from "@/lib/leads/ids";
import { normalizeLead } from "@/lib/leads/normalize";
import { readSuppressionState, writeAudit } from "@/lib/db/settings";
import { mergeSourceRefs, type ApifySourceRef } from "@/lib/apify/lineage";
import { stopSequencesForLead } from "@/lib/outreach/sequence";
import { parseLeadInput } from "@/lib/contracts/lead-input";
import { classifyLeadEnvironment, isTestLeadRecord } from "@/lib/analytics/production";
import { decideImportLead } from "@/lib/leads/import-policy";
import { isGoogleMapsUrl } from "@/lib/scraping/maps-url";
import type { RawLeadInput } from "@/types";

export type IngestableLead = RawLeadInput & {
  sourceActor?: string | null;
  sourceUrl?: string | null;
  sourceRunId?: string | null;
  sourceDatasetId?: string | null;
  sourceRef?: unknown;
  rawPayload?: unknown;
};

export async function ingestLeads(input: {
  leads: IngestableLead[];
  sourceId?: string | null;
  sourceName?: string;
  campaignId?: string | null;
}) {
  const stored: string[] = [];
  const storedIds: string[] = [];
  const duplicates: string[] = [];
  let skippedEmpty = 0;
  let skippedInvalid = 0;
  let skippedNonBuyer = 0;
  let skippedExcluded = 0;

  for (const raw of input.leads) {
    const parsed = parseLeadInput(raw);
    if (!parsed.ok) {
      if (parsed.code === "EMPTY") skippedEmpty += 1;
      else skippedInvalid += 1;
      continue;
    }
    const decision = decideImportLead({
      name: parsed.normalized.name,
      company: parsed.normalized.company,
      website: parsed.normalized.website,
      email: parsed.normalized.email,
      industry: parsed.normalized.industry,
      location: parsed.normalized.location,
      notes: parsed.normalized.notes,
      sourceUrl: raw.sourceUrl,
    });
    if (decision.action === "skip-non-buyer") {
      skippedNonBuyer += 1;
      continue;
    }
    if (decision.action === "skip-excluded") {
      skippedExcluded += 1;
      continue;
    }
    const normalized = {
      ...parsed.normalized,
      website: decision.website,
      websiteHost: decision.websiteHost,
      missingFields: decision.website
        ? parsed.normalized.missingFields
        : Array.from(new Set([...parsed.normalized.missingFields, "website"])),
    };
    const sourceUrl = decision.sourceUrl ?? raw.sourceUrl ?? null;
    const profileData = decision.profile
      ? {
          profileFitStatus: decision.profile.status,
          profileFitScore: decision.profile.score,
          profileFitReason: decision.profile.reason,
        }
      : {
          profileFitStatus: null,
          profileFitScore: null,
          profileFitReason: null,
        };

    const blocked = (await readSuppressionState({
      email: normalized.email,
      websiteHost: normalized.websiteHost,
      phone: normalized.phone,
    })) !== "clear";

    const existing = await findDuplicate(normalized);
    const extras = {
      sourceActor: raw.sourceActor ?? null,
      sourceUrl,
      sourceRunId: raw.sourceRunId ?? null,
      sourceDatasetId: raw.sourceDatasetId ?? null,
      sourceRef: raw.sourceRef as ApifySourceRef | undefined,
      rawPayload: raw.rawPayload ? (raw.rawPayload as Prisma.InputJsonValue) : (raw as Prisma.InputJsonValue),
    };

    if (existing) {
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: existing.name ?? normalized.name,
          company: existing.company ?? normalized.company,
          website: isGoogleMapsUrl(existing.website) ? normalized.website : (existing.website ?? normalized.website),
          websiteHost: isGoogleMapsUrl(existing.website) ? normalized.websiteHost : (existing.websiteHost ?? normalized.websiteHost),
          email: existing.email ?? normalized.email,
          phone: existing.phone ?? normalized.phone,
          linkedinUrl: existing.linkedinUrl ?? normalized.linkedinUrl,
          instagramUrl: existing.instagramUrl ?? normalized.instagramUrl,
          facebookUrl: existing.facebookUrl ?? normalized.facebookUrl,
          twitterUrl: existing.twitterUrl ?? normalized.twitterUrl,
          location: existing.location ?? normalized.location,
          industry: existing.industry ?? normalized.industry,
          sourceActor: existing.sourceActor ?? extras.sourceActor,
          sourceUrl: existing.sourceUrl ?? extras.sourceUrl,
          profileFitStatus: existing.profileFitStatus ?? profileData.profileFitStatus,
          profileFitScore: existing.profileFitScore ?? profileData.profileFitScore,
          profileFitReason: existing.profileFitReason ?? profileData.profileFitReason,
          sourceRunId: existing.sourceRunId ?? extras.sourceRunId,
          sourceDatasetId: existing.sourceDatasetId ?? extras.sourceDatasetId,
          sourceRefs: mergeSourceRefs(existing.sourceRefs, extras.sourceRef ?? apifyRefFromExtras(extras)),
          lastActivityAt: new Date(),
          testRecipient: normalized.testRecipient === true,
          fixture: isTestLeadRecord({
            testRecipient: normalized.testRecipient === true,
            source: normalized.source ?? input.sourceName,
            email: normalized.email,
            company: normalized.company,
          }),
          environment: classifyLeadEnvironment({
            testRecipient: normalized.testRecipient === true,
            source: normalized.source ?? input.sourceName,
            email: normalized.email,
            company: normalized.company,
          }),
          normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
          rawPayload: existing.rawPayload ?? extras.rawPayload,
          ...(blocked
            ? { suppressed: true, status: "DO_NOT_CONTACT" as const }
            : existing.suppressed || existing.status === "DO_NOT_CONTACT"
              ? { suppressed: true, status: "DO_NOT_CONTACT" as const }
              : {}),
        },
      });
      if (input.campaignId) {
        await prisma.campaignLead.upsert({
          where: {
            campaignId_leadId: { campaignId: input.campaignId, leadId: existing.id },
          },
          update: {},
          create: { campaignId: input.campaignId, leadId: existing.id },
        });
      }
      if (blocked || existing.suppressed || existing.status === "DO_NOT_CONTACT") {
        await stopSequencesForLead(existing.id, "UNSUBSCRIBE");
      }
      duplicates.push(existing.leadId);
      continue;
    }

    const lead = await prisma.lead.create({
      data: {
        leadId: createLeadId(),
        name: normalized.name,
        company: normalized.company,
        website: normalized.website,
        email: normalized.email,
        phone: normalized.phone,
        linkedinUrl: normalized.linkedinUrl,
        instagramUrl: normalized.instagramUrl,
        facebookUrl: normalized.facebookUrl,
        twitterUrl: normalized.twitterUrl,
        source: normalized.source ?? input.sourceName ?? "apify",
        location: normalized.location,
        industry: normalized.industry,
        originalPost: normalized.originalPost,
        notes: normalized.notes,
        missingFields: normalized.missingFields,
        websiteHost: normalized.websiteHost,
        externalRowId: normalized.externalRowId,
        sourceId: input.sourceId ?? null,
        suppressed: blocked,
        testRecipient: normalized.testRecipient === true,
        fixture: isTestLeadRecord({
          testRecipient: normalized.testRecipient === true,
          source: normalized.source ?? input.sourceName,
          email: normalized.email,
          company: normalized.company,
        }),
        environment: classifyLeadEnvironment({
          testRecipient: normalized.testRecipient === true,
          source: normalized.source ?? input.sourceName,
          email: normalized.email,
          company: normalized.company,
        }),
        status: blocked ? "DO_NOT_CONTACT" : "NEW",
        profileFitStatus: profileData.profileFitStatus,
        profileFitScore: profileData.profileFitScore,
        profileFitReason: profileData.profileFitReason,
        lastActivityAt: new Date(),
        sourceActor: extras.sourceActor,
        sourceUrl: extras.sourceUrl,
        sourceRunId: extras.sourceRunId,
        sourceDatasetId: extras.sourceDatasetId,
        sourceRefs: extras.sourceRef ? [extras.sourceRef] : [],
        rawPayload: extras.rawPayload,
        normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
      },
    });
    if (input.campaignId) {
      await prisma.campaignLead.create({
        data: { campaignId: input.campaignId, leadId: lead.id },
      });
    }
    stored.push(lead.leadId);
    storedIds.push(lead.id);
    await writeAudit({
      action: "lead.discovered",
      entity: "lead",
      entityId: lead.id,
      payload: { source: lead.source, suppressed: blocked },
    });
  }

  return {
    stored: stored.length,
    duplicates: duplicates.length,
    skippedEmpty,
    skippedInvalid,
    skippedNonBuyer,
    skippedExcluded,
    leadIds: stored,
    storedIds,
    duplicateIds: duplicates,
  };
}

export async function findDuplicate(normalized: ReturnType<typeof normalizeLead>) {
  const clauses = [
    normalized.email ? { email: normalized.email } : undefined,
    normalized.websiteHost ? { websiteHost: normalized.websiteHost } : undefined,
    normalized.linkedinUrl ? { linkedinUrl: normalized.linkedinUrl } : undefined,
    normalized.twitterUrl ? { twitterUrl: normalized.twitterUrl } : undefined,
  ].filter(Boolean) as Prisma.LeadWhereInput[];
  if (clauses.length === 0) return null;
  return prisma.lead.findFirst({ where: { OR: clauses } });
}

function apifyRefFromExtras(extras: {
  sourceActor: string | null;
  sourceRunId: string | null;
  sourceDatasetId: string | null;
}): ApifySourceRef {
  return {
    source: "APIFY",
    actor_id: extras.sourceActor ?? "unknown",
    run_id: extras.sourceRunId,
    dataset_id: extras.sourceDatasetId,
    imported_at: new Date().toISOString(),
  };
}
