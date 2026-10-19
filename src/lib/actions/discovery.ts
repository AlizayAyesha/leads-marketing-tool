"use server";

import { revalidatePath } from "next/cache";

import { enqueue, processQueue } from "@/lib/queue/engine";
import { identifyMissingLinkedIn } from "@/lib/enrichment/identify";
import { discoverDubaiLuxuryBusinesses, discoverProspects } from "@/lib/discovery/search";
import { discoverTwitterIntentLeads } from "@/lib/twitter/discover";
import { writeAudit } from "@/lib/db/settings";

function refresh() {
  revalidatePath("/research");
  revalidatePath("/leads");
  revalidatePath("/outreach");
  revalidatePath("/integrations");
  revalidatePath("/integrations/actors");
}

export async function enrichMissingLinkedInAction(formData?: FormData) {
  const runPipeline = String(formData?.get("runPipeline") ?? "true") !== "false";
  const dryRun = String(formData?.get("dryRun") ?? "") === "true";
  const result = await identifyMissingLinkedIn({ dryRun });
  if (result.ok && runPipeline && !dryRun) {
    for (const row of result.results.filter((item) => item.wrote)) {
      await enqueue({ type: "PIPELINE_LEAD", leadId: row.leadId });
    }
    if (result.results.some((item) => item.wrote)) {
      await processQueue(Math.min(5, result.results.filter((item) => item.wrote).length));
    }
  }
  await writeAudit({
    action: "discover.enrich_requested",
    entity: "pdl",
    payload: { ok: result.ok, wrote: result.results.filter((item) => item.wrote).length, dryRun, runPipeline },
  });
  refresh();
  return result;
}

export async function discoverProspectsAction(formData?: FormData) {
  const runPipeline = String(formData?.get("runPipeline") ?? "true") !== "false";
  const dryRun = String(formData?.get("dryRun") ?? "") === "true";
  const result = await discoverProspects({ dryRun });
  if (result.ok && runPipeline && !dryRun) {
    for (const leadId of result.leadIds) {
      await enqueue({ type: "PIPELINE_LEAD", leadId });
    }
    if (result.leadIds.length) {
      await processQueue(Math.min(5, result.leadIds.length));
    }
  }
  await writeAudit({
    action: "discover.prospects_requested",
    entity: "pdl",
    payload: { ok: result.ok, stored: result.stored, dryRun, runPipeline },
  });
  refresh();
  return result;
}

export async function discoverDubaiLuxuryAction(formData?: FormData) {
  const runPipeline = String(formData?.get("runPipeline") ?? "true") !== "false";
  const dryRun = String(formData?.get("dryRun") ?? "") === "true";
  const result = await discoverDubaiLuxuryBusinesses({ dryRun });
  if (result.ok && runPipeline && !dryRun) {
    for (const leadId of result.leadIds) {
      await enqueue({ type: "PIPELINE_LEAD", leadId });
    }
    if (result.leadIds.length) {
      await processQueue(Math.min(5, result.leadIds.length));
    }
  }
  await writeAudit({
    action: "discover.dubai_luxury_requested",
    entity: "firecrawl",
    payload: { ok: result.ok, stored: result.stored, dryRun, runPipeline },
  });
  refresh();
  return result;
}

export async function discoverTwitterIntentAction(formData?: FormData) {
  const runPipeline = String(formData?.get("runPipeline") ?? "true") !== "false";
  const dryRun = String(formData?.get("dryRun") ?? "") === "true";
  const maxItems = Number(formData?.get("maxItems") || 40) || 40;
  const result = await discoverTwitterIntentLeads({ dryRun, maxItems });
  let handoff: Awaited<ReturnType<typeof import("@/lib/twitter/outreach-handoff").handoffTwitterIntentLeads>> | null =
    null;
  if (result.ok && !dryRun && result.leadIds.length) {
    const { handoffTwitterIntentLeads } = await import("@/lib/twitter/outreach-handoff");
    handoff = await handoffTwitterIntentLeads({
      leadIds: result.leadIds,
      enrichLinkedIn: true,
      runPipeline,
    });
  }
  refresh();
  return { ...result, handoff };
}
