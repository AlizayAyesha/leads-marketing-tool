import "server-only";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { isFreshAudit } from "@/lib/outreach/gate";

/** Max age for operator re-stamp of an existing PASS (no OpenAI). Never upgrades REJECT/HOLD. */
export const PASS_REFRESH_MAX_MS = 45 * 24 * 60 * 60 * 1000;

type AuditLike = {
  id: string;
  verdict: string;
  createdAt: Date;
  summary: string;
  checks: unknown;
  professionalStatus: string;
  emailStatus: string;
  linkedinStatus: string;
  linkedinSeniority: string;
  instagramStatus: string;
  instagramPresence: string;
  serviceNeedStatus: string;
  allowedChannels: unknown;
  blockers: unknown;
  unknowns: unknown;
  evidenceUsed: unknown;
  recommendedAction: string;
  score?: number | null;
};

/**
 * Re-stamp a single PASS if older than 14 days but within PASS_REFRESH_MAX_MS.
 * Used by operator bulk email / LinkedIn / Twitter home clicks when OpenAI cannot re-audit.
 */
export async function refreshPassAuditIfNeeded(
  leadId: string,
  audit: AuditLike,
  reason = "operator_refresh",
) {
  if (audit.verdict !== "PASS") return { ok: false as const, code: "NOT_PASS" };
  if (isFreshAudit(audit.createdAt)) return { ok: true as const, code: "FRESH" };
  const age = Date.now() - audit.createdAt.getTime();
  if (age > PASS_REFRESH_MAX_MS) return { ok: false as const, code: "TOO_OLD" };
  await prisma.leadAudit.create({
    data: {
      leadId,
      verdict: "PASS",
      summary: `${audit.summary} [${reason}]`,
      checks: (audit.checks as object) ?? {},
      professionalStatus: audit.professionalStatus,
      emailStatus: audit.emailStatus,
      linkedinStatus: audit.linkedinStatus,
      linkedinSeniority: audit.linkedinSeniority,
      instagramStatus: audit.instagramStatus,
      instagramPresence: audit.instagramPresence,
      serviceNeedStatus: audit.serviceNeedStatus,
      allowedChannels: (audit.allowedChannels as object) ?? [],
      blockers: (audit.blockers as object) ?? [],
      unknowns: (audit.unknowns as object) ?? [],
      evidenceUsed: (audit.evidenceUsed as object) ?? [],
      recommendedAction: audit.recommendedAction,
      score: audit.score ?? null,
      mode: "heuristic",
      modelProvider: "operator-refresh",
    },
  });
  await writeAudit({
    action: "audit.refresh_pass",
    entity: "lead",
    entityId: leadId,
    payload: { priorAuditId: audit.id, reason, maxAgeDays: PASS_REFRESH_MAX_MS / 86400000 },
  });
  return { ok: true as const, code: "REFRESHED" };
}

/** Bulk refresh latest PASS audits for a set of leads. Returns how many were re-stamped. */
export async function refreshStalePassAuditsForLeads(leadIds: string[], reason = "operator_daily_refresh") {
  const unique = [...new Set(leadIds.filter(Boolean))];
  let refreshed = 0;
  for (const leadId of unique) {
    const audit = await prisma.leadAudit.findFirst({
      where: { leadId },
      orderBy: { createdAt: "desc" },
    });
    if (!audit) continue;
    const result = await refreshPassAuditIfNeeded(leadId, audit, reason);
    if (result.code === "REFRESHED") refreshed += 1;
  }
  return refreshed;
}
