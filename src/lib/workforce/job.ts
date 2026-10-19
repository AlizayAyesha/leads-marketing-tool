import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting } from "@/lib/db/settings";
import { enqueue, processQueueParallel } from "@/lib/queue/engine";
import { importFromConfiguredSheet } from "@/lib/google/sync";
import { workforceStages } from "@/lib/workforce/plan";
import type { WorkforceFunnel, WorkforcePlan } from "@/lib/workforce/types";

export const LAST_JOB_KEY = "workforce.lastJob";

export async function getLastWorkforceJob() {
  return getSetting<WorkforceFunnel | null>(LAST_JOB_KEY, null);
}

export async function runWorkforceJob(
  input: WorkforcePlan & { command: string },
): Promise<WorkforceFunnel> {
  const limit = input.limit;
  const top = input.top;
  let imported = 0;
  let importedLeadIds: string[] = [];
  let note: string | undefined;

  if (input.importSheet) {
    try {
      const result = (await importFromConfiguredSheet({ limit })) as {
        stored?: number;
        leadIds?: string[];
        processedLeadIds?: string[];
        pending?: boolean;
        message?: string;
      };
      if (result?.pending) {
        note = result.message ?? "Google Sheet is not connected. Continuing on stored leads.";
      } else {
        imported = Number(result?.stored ?? result?.leadIds?.length ?? 0);
        importedLeadIds = result?.processedLeadIds ?? result?.leadIds ?? [];
      }
    } catch (error) {
      note =
        error instanceof Error
          ? `${error.message} Continuing on stored leads.`
          : "Sheet import failed. Continuing on stored leads.";
    }
  }

  const leads = await prisma.lead.findMany({
    where: {
      suppressed: false,
      status: { notIn: ["DO_NOT_CONTACT", "LOST"] },
      ...(importedLeadIds.length ? { leadId: { in: importedLeadIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { research: { take: 1 } },
  });

  const researchTasks = [];
  for (const lead of leads) {
    if (lead.research.length) continue;
    researchTasks.push(await enqueue({ type: "RESEARCH_LEAD", leadId: lead.id, timeoutMs: 45_000 }));
  }
  const researchResults = await processQueueParallel(
    researchTasks.map((task) => task.id),
    4,
  );
  const failed = researchResults.filter((item) => item.status === "FAILED").length;

  const qualifyTasks = [];
  for (const lead of leads) {
    qualifyTasks.push(await enqueue({ type: "QUALIFY_LEAD", leadId: lead.id }));
  }
  await processQueueParallel(
    qualifyTasks.map((task) => task.id),
    4,
  );

  const auditTasks = [];
  for (const lead of leads) {
    auditTasks.push(await enqueue({ type: "AUDIT_LEAD", leadId: lead.id }));
  }
  await processQueueParallel(
    auditTasks.map((task) => task.id),
    4,
  );

  const audited = await prisma.lead.findMany({
    where: { id: { in: leads.map((lead) => lead.id) } },
    include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const surviving = audited.filter((lead) => lead.audits[0]?.verdict !== "REJECT");

  const opportunityTasks = [];
  for (const lead of surviving) {
    opportunityTasks.push(await enqueue({ type: "OPPORTUNITY_LEAD", leadId: lead.id }));
  }
  await processQueueParallel(
    opportunityTasks.map((task) => task.id),
    4,
  );

  const scored = await prisma.lead.findMany({
    where: { id: { in: leads.map((lead) => lead.id) } },
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      research: { orderBy: { createdAt: "desc" }, take: 1 },
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const researched = scored.filter((lead) => lead.research.length).length;
  const opportunities = scored.filter(
    (lead) => lead.opportunities[0] && lead.opportunities[0].projectCategory !== "unknown",
  ).length;
  const qualified = scored.filter((lead) => {
    const breakdown = (lead.scores[0]?.breakdown ?? {}) as { decision?: string };
    return breakdown.decision === "QUALIFIED" && lead.audits[0]?.verdict !== "REJECT";
  }).length;
  const recommended = [...scored]
    .sort((a, b) => (b.scores[0]?.score ?? 0) - (a.scores[0]?.score ?? 0))
    .filter((lead) => {
      const breakdown = (lead.scores[0]?.breakdown ?? {}) as { decision?: string };
      return breakdown.decision === "QUALIFIED" && lead.audits[0]?.verdict === "PASS";
    })
    .slice(0, top);

  const draftTasks = [];
  for (const lead of recommended) {
    draftTasks.push(await enqueue({ type: "WRITE_OUTREACH", leadId: lead.id }));
  }
  await processQueueParallel(
    draftTasks.map((task) => task.id),
    3,
  );

  const draftCount = await prisma.outreachDraft.count({
    where: {
      leadId: { in: recommended.map((lead) => lead.id) },
      status: { in: ["PENDING_APPROVAL", "EDITED"] },
    },
  });
  const draftRows = recommended.length
    ? await prisma.outreachDraft.findMany({
        where: {
          leadId: { in: recommended.map((lead) => lead.id) },
          status: { in: ["PENDING_APPROVAL", "EDITED"] },
        },
        include: {
          lead: {
            include: {
              scores: { orderBy: { createdAt: "desc" }, take: 1 },
              opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: top,
      })
    : [];

  const funnel: WorkforceFunnel = {
    jobId: `JOB-${Date.now().toString(36).toUpperCase()}`,
    command: input.command,
    simulate: input.simulate || input.intent === "SIMULATE_CAMPAIGN",
    imported,
    valid: leads.length,
    researched,
    opportunities,
    qualified,
    recommended: recommended.length,
    drafts: draftCount,
    sent: 0,
    failed,
    status: "AWAITING_YOUR_APPROVAL",
    leadIds: recommended.map((lead) => lead.leadId),
    stages: input.stages.length ? input.stages : workforceStages(limit, top),
    note,
    draftPreviews: draftRows.map((draft) => ({
      draftId: draft.id,
      leadId: draft.lead.leadId,
      lead: draft.lead.name || draft.lead.company || draft.lead.leadId,
      company: draft.lead.company,
      opportunity: draft.lead.opportunities[0]?.suggestedOffer ?? null,
      businessProblem: draft.lead.opportunities[0]?.problem ?? null,
      qualificationScore: draft.lead.scores[0]?.score ?? null,
      recommendedService: draft.lead.opportunities[0]?.recommendedService ?? null,
      channel: draft.channel,
      draft: draft.message,
      approvalStatus: draft.status,
    })),
  };

  await setSetting(LAST_JOB_KEY, funnel);
  return funnel;
}

export function describeWorkforceJob(funnel: WorkforceFunnel, opening: string) {
  const lines = [
    opening,
    "",
    `${funnel.jobId}`,
    `${funnel.valid} leads`,
    `${funnel.researched} researched`,
    `${funnel.opportunities} opportunities`,
    `${funnel.qualified} qualified`,
    `${funnel.recommended} decision-maker PASS`,
    `${funnel.drafts} outreach drafts`,
    `STATUS: ${funnel.status}`,
    `External messages sent: ${funnel.sent}`,
  ];
  if (funnel.note) lines.push(funnel.note);
  return lines.join("\n");
}
