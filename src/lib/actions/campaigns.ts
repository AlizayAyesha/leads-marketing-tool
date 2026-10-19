"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import {
  exportCampaignLeads,
  startCampaignRun,
  syncCampaignRun,
} from "@/lib/campaigns/runner";
import {
  defaultCampaignBrief,
  parseCampaignIntent,
  type CampaignIntent,
  type CompanySize,
} from "@/lib/campaigns/intent";
import { writeAudit } from "@/lib/db/settings";

function refresh(id?: string) {
  revalidatePath("/campaigns");
  if (id) revalidatePath(`/campaigns/${id}`);
}

function normalizeBrief(input: {
  targetCount?: number;
  cities?: string;
  regions?: string;
  companySizes?: CompanySize[];
  needCriteria?: string;
}): CampaignIntent {
  const cities = (input.cities ?? "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const regions = (input.regions ?? "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const base = defaultCampaignBrief();
  return parseCampaignIntent({
    ...base,
    targetCount: input.targetCount && input.targetCount > 0 ? Math.floor(input.targetCount) : base.targetCount,
    maxLeadsPerDay: input.targetCount && input.targetCount > 0 ? Math.floor(input.targetCount) : base.maxLeadsPerDay,
    cities: cities.length ? cities : base.cities,
    regions: regions.length ? regions : base.regions,
    companySizes: input.companySizes?.length ? input.companySizes : base.companySizes,
    needCriteria: input.needCriteria?.trim() || base.needCriteria,
  });
}

export async function saveCampaign(input: {
  id?: string;
  name: string;
  description?: string;
  actorIds: string[];
  runAiAfterScrape: boolean;
  sheetSpreadsheetId?: string;
  sheetWorksheet?: string;
  targetCount?: number;
  cities?: string;
  regions?: string;
  companySizes?: CompanySize[];
  needCriteria?: string;
}) {
  const name = input.name.trim();
  if (!name) return { error: "Campaign name is required." };

  const filters = normalizeBrief({
    targetCount: input.targetCount,
    cities: input.cities,
    regions: input.regions,
    companySizes: input.companySizes,
    needCriteria: input.needCriteria,
  });

  const campaign = input.id
    ? await prisma.campaign.update({
        where: { id: input.id },
        data: {
          name,
          description: input.description || null,
          runAiAfterScrape: input.runAiAfterScrape,
          sheetSpreadsheetId: input.sheetSpreadsheetId || null,
          sheetWorksheet: input.sheetWorksheet || null,
          filters,
        },
      })
    : await prisma.campaign.create({
        data: {
          name,
          description: input.description || null,
          runAiAfterScrape: input.runAiAfterScrape,
          sheetSpreadsheetId: input.sheetSpreadsheetId || null,
          sheetWorksheet: input.sheetWorksheet || null,
          filters,
          status: "DRAFT",
        },
      });

  await prisma.campaignActor.deleteMany({
    where: {
      campaignId: campaign.id,
      apifyActorId: { notIn: input.actorIds },
    },
  });
  for (const apifyActorId of input.actorIds) {
    await prisma.campaignActor.upsert({
      where: { campaignId_apifyActorId: { campaignId: campaign.id, apifyActorId } },
      update: { enabled: true },
      create: { campaignId: campaign.id, apifyActorId, enabled: true },
    });
  }

  await writeAudit({ action: "campaign.save", entity: "campaign", entityId: campaign.id });
  refresh(campaign.id);
  return { id: campaign.id };
}

export async function runCampaignAction(campaignId: string, testMode: boolean) {
  const run = await startCampaignRun(campaignId, testMode);
  await syncCampaignRun(run.id);
  refresh(campaignId);
  revalidatePath(`/campaigns/${campaignId}/runs/${run.id}`);
  return { runId: run.id };
}

export async function syncCampaignRunAction(runId: string) {
  const result = await syncCampaignRun(runId);
  const run = await prisma.campaignRun.findUnique({ where: { id: runId } });
  if (run) refresh(run.campaignId);
  revalidatePath(`/campaigns/${run?.campaignId}/runs/${runId}`);
  return result;
}

export async function exportCampaignSheetAction(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign?.sheetSpreadsheetId || !campaign.sheetWorksheet) {
    return { error: "Set a Google Sheet destination on the campaign first." };
  }
  try {
    const result = await exportCampaignLeads(
      campaignId,
      campaign.sheetSpreadsheetId,
      campaign.sheetWorksheet,
    );
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sheet export failed" };
  }
}
