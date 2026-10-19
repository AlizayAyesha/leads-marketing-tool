import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { createLeadId } from "@/lib/leads/ids";
import { normalizeLead } from "@/lib/leads/normalize";
import { parseLeadInput } from "@/lib/contracts/lead-input";
import { isSuppressed, writeAudit } from "@/lib/db/settings";
import type { RawLeadInput } from "@/types";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import type { AgentContext, AgentResult } from "@/lib/agents/types";

export class IntakeAgent extends BaseAgent {
  slug = "intake";
  name = "Lead Intake Agent";
  description = "Import, normalize, dedupe, and store leads.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const leads = (ctx.payload?.leads as RawLeadInput[] | undefined) ?? [];
    const sourceId = (ctx.payload?.sourceId as string | undefined) ?? null;
    const sourceName = (ctx.payload?.sourceName as string | undefined) ?? "manual";

    if (leads.length === 0 && ctx.lead) {
      return {
        ok: true,
        mode: "heuristic",
        output: { stored: 1, duplicates: 0, leadIds: [ctx.lead.leadId] },
      };
    }

    const stored: string[] = [];
    const duplicates: string[] = [];
    const suppressed: string[] = [];
    let skippedInvalid = 0;

    for (const raw of leads) {
      const parsed = parseLeadInput(raw);
      if (!parsed.ok) {
        skippedInvalid += 1;
        continue;
      }
      const normalized = parsed.normalized;

      const blocked = await isSuppressed({
        email: normalized.email,
        websiteHost: normalized.websiteHost,
        phone: normalized.phone,
      });

      const existing = await findDuplicate(normalized);
      const data = {
        name: normalized.name,
        company: normalized.company,
        website: normalized.website,
        email: normalized.email,
        phone: normalized.phone,
        linkedinUrl: normalized.linkedinUrl,
        instagramUrl: normalized.instagramUrl,
        facebookUrl: normalized.facebookUrl,
        twitterUrl: normalized.twitterUrl,
        source: normalized.source ?? sourceName,
        location: normalized.location,
        industry: normalized.industry,
        originalPost: normalized.originalPost,
        notes: normalized.notes,
        testRecipient: normalized.testRecipient === true,
        missingFields: normalized.missingFields,
        websiteHost: normalized.websiteHost,
        externalRowId: normalized.externalRowId,
        sourceId,
        suppressed: blocked,
        status: blocked ? "DO_NOT_CONTACT" : "NEW",
        lastActivityAt: new Date(),
        normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
      } satisfies Prisma.LeadUncheckedUpdateInput;

      if (existing) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: {
            ...data,
            duplicateOfId: existing.duplicateOfId ?? null,
            rawPayload: existing.rawPayload ?? (raw as Prisma.InputJsonValue),
          },
        });
        duplicates.push(existing.leadId);
        continue;
      }

      const lead = await prisma.lead.create({
        data: {
          leadId: createLeadId(),
          ...data,
          missingFields: normalized.missingFields,
          rawPayload: (raw as Prisma.InputJsonValue),
        },
      });
      if (blocked) suppressed.push(lead.leadId);
      stored.push(lead.leadId);
    }

    await writeAudit({
      action: "intake.import",
      entity: "lead",
      payload: { stored: stored.length, duplicates: duplicates.length, sourceName },
    });

    await this.askJson(DEFAULT_PROMPTS.intake.content, JSON.stringify({ stored, duplicates }));

    return {
      ok: true,
      mode: "heuristic",
      output: {
        stored: stored.length,
        duplicates: duplicates.length,
        suppressed: suppressed.length,
        skippedInvalid,
        leadIds: stored,
        processedLeadIds: [...stored, ...duplicates],
        urlIssuesNoted: true,
      },
    };
  }
}

async function findDuplicate(normalized: ReturnType<typeof normalizeLead>) {
  const clauses = [
    normalized.email ? { email: normalized.email } : undefined,
    normalized.websiteHost ? { websiteHost: normalized.websiteHost } : undefined,
    normalized.linkedinUrl ? { linkedinUrl: normalized.linkedinUrl } : undefined,
    normalized.twitterUrl ? { twitterUrl: normalized.twitterUrl } : undefined,
  ].filter(Boolean) as Prisma.LeadWhereInput[];
  if (!clauses.length) return null;
  return prisma.lead.findFirst({ where: { OR: clauses } });
}
