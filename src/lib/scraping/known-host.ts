import "server-only";

import { prisma } from "@/lib/db/prisma";
import { productionLeadWhere } from "@/lib/analytics/production";
import { safeHost } from "@/lib/utils";

export type KnownHostLead = {
  id: string;
  leadId: string;
  company: string | null;
  websiteHost: string | null;
};

export function normalizeWebsiteHost(url: string | null | undefined) {
  return safeHost(url);
}

export async function findProductionLeadByWebsiteHost(host: string | null | undefined): Promise<KnownHostLead | null> {
  const normalized = normalizeWebsiteHost(host);
  if (!normalized) return null;
  return prisma.lead.findFirst({
    where: { AND: [productionLeadWhere(), { websiteHost: normalized }] },
    select: { id: true, leadId: true, company: true, websiteHost: true },
  });
}

export async function loadKnownProductionHosts(hosts: string[]) {
  const normalized = [...new Set(hosts.map((host) => normalizeWebsiteHost(host)).filter(Boolean))] as string[];
  if (!normalized.length) return new Map<string, KnownHostLead>();

  const rows = await prisma.lead.findMany({
    where: { AND: [productionLeadWhere(), { websiteHost: { in: normalized } }] },
    select: { id: true, leadId: true, company: true, websiteHost: true },
  });

  const map = new Map<string, KnownHostLead>();
  for (const row of rows) {
    if (row.websiteHost) map.set(row.websiteHost, row);
  }
  return map;
}
