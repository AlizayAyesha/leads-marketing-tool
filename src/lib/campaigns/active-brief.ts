import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  defaultCampaignBrief,
  parseCampaignIntent,
  type CampaignIntent,
} from "@/lib/campaigns/intent";

/**
 * Brief used for send-time geo filter.
 * Only ACTIVE campaigns enforce cities/regions. No ACTIVE campaign → {} (world OK).
 * Defaults seed discover only — they must not block existing inventory.
 */
export async function getActiveCampaignBrief(): Promise<CampaignIntent> {
  const active = await prisma.campaign.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    select: { filters: true },
  });
  if (!active) return {};
  const parsed = parseCampaignIntent(active.filters);
  if (parsed.cities?.length || parsed.regions?.length || parsed.geo?.trim()) return parsed;
  return {};
}

/** Brief for Maps/Firecrawl seed queries — ACTIVE cities, else Karachi/Ibiza/elite defaults. */
export async function getDiscoverSeedBrief(): Promise<CampaignIntent> {
  const active = await getActiveCampaignBrief();
  if (active.cities?.length || active.regions?.length || active.geo?.trim()) {
    return { ...defaultCampaignBrief(), ...active };
  }
  return defaultCampaignBrief();
}
