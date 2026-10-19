"use server";

import { revalidatePath } from "next/cache";

import { enqueue, processQueue } from "@/lib/queue/engine";
import { runLeadPipeline } from "@/lib/pipeline/run";
import { runWorkforceJob } from "@/lib/workforce/job";
import { openingFor, workforceStages } from "@/lib/workforce/plan";

export async function runPipelineForLead(leadId: string) {
  const task = await enqueue({ type: "PIPELINE_LEAD", leadId });
  await processQueue(3);
  revalidateAll();
  return { taskId: task.id };
}

export async function runAgentOnLead(
  leadId: string,
  type: "RESEARCH_LEAD" | "QUALIFY_LEAD" | "AUDIT_LEAD" | "OPPORTUNITY_LEAD" | "WRITE_OUTREACH" | "FOLLOW_UP_LEAD",
) {
  const task = await enqueue({ type, leadId });
  await processQueue(1);
  revalidateAll();
  return { taskId: task.id };
}

export async function runPipelineNow(leadId: string) {
  const result = await runLeadPipeline(leadId);
  revalidateAll();
  return result;
}

export async function researchNewLeadsAction() {
  await researchNewLeads();
}

export async function runFiveLeadSheetTest() {
  const limit = 5;
  const result = await runWorkforceJob({
    intent: "PROCESS_WORKFORCE",
    command: "Run the five-lead Google Sheet validation pipeline",
    importSheet: true,
    limit,
    top: limit,
    simulate: false,
    stages: workforceStages(limit, limit),
    opening: openingFor(limit),
  });
  revalidateAll();
  revalidatePath("/integrations/sheets");
  return result;
}

export async function runPipelineNowAction(leadId: string) {
  await runPipelineNow(leadId);
}

export async function runAgentOnLeadAction(
  leadId: string,
  type: "RESEARCH_LEAD" | "QUALIFY_LEAD" | "AUDIT_LEAD" | "OPPORTUNITY_LEAD" | "WRITE_OUTREACH" | "FOLLOW_UP_LEAD",
) {
  await runAgentOnLead(leadId, type);
}

export async function researchNewLeads() {
  const { prisma } = await import("@/lib/db/prisma");
  const leads = await prisma.lead.findMany({
    where: { status: "NEW", suppressed: false },
    take: 20,
  });
  for (const lead of leads) {
    await enqueue({ type: "PIPELINE_LEAD", leadId: lead.id });
  }
  await processQueue(4);
  revalidateAll();
  return { queued: leads.length };
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/research");
  revalidatePath("/outreach");
  revalidatePath("/agents");
}
