import "server-only";

import { prisma } from "@/lib/db/prisma";
import { HARD_PDL_DISCOVER_DAILY_CAP, HARD_PDL_LOOKUP_DAILY_CAP } from "@/lib/pdl/constants";
import { pdlDailyQuota, type PdlDailyQuota } from "@/lib/pdl/quota";

function startOfLocalDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function countPdlDailyUsage(now = new Date()): Promise<PdlDailyQuota> {
  const start = startOfLocalDay(now);
  const [lookupsToday, discoveriesToday] = await Promise.all([
    prisma.auditLog.count({
      where: {
        action: "pdl.person_enrich",
        createdAt: { gte: start },
      },
    }),
    prisma.auditLog.count({
      where: {
        action: "pdl.person_search_ingest",
        createdAt: { gte: start },
      },
    }),
  ]);
  return pdlDailyQuota({
    lookupsToday,
    discoveriesToday,
    lookupCap: HARD_PDL_LOOKUP_DAILY_CAP,
    discoverCap: HARD_PDL_DISCOVER_DAILY_CAP,
  });
}
