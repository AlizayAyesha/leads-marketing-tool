"use server";

import { revalidatePath } from "next/cache";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ApifyService } from "@/lib/apify/service";
import { schemaToFields, guessMapping, collectKeys, type OutputMapping } from "@/lib/actors/mapping";
import { enqueue, processQueue } from "@/lib/queue/engine";
import { validateActorConfig, validateOutputMapping } from "@/lib/apify/validate";
import { syncStandaloneActorRun } from "@/lib/campaigns/runner";
import { writeAudit } from "@/lib/db/settings";

function refresh(id?: string) {
  revalidatePath("/integrations");
  revalidatePath("/integrations/actors");
  revalidatePath("/campaigns");
  revalidatePath("/");
  revalidatePath("/outreach");
  if (id) revalidatePath(`/integrations/actors/${id}`);
}

export async function createActor(formData: FormData) {
  const actorId = String(formData.get("actorId") || "").trim();
  const displayName = String(formData.get("displayName") || "").trim();
  const parsed = validateActorConfig({ actorId, name: displayName });
  if (!parsed.ok) return { error: parsed.issues[0]?.message ?? "Invalid actor configuration." };

  let inputSchema = {};
  let description = String(formData.get("description") || "") || null;
  try {
    const meta = await new ApifyService().getActorMeta(actorId);
    inputSchema = meta.inputSchema ?? {};
    description = description || meta.description;
  } catch (error) {
    if (!String(formData.get("allowWithoutMeta"))) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not load actor metadata. Check the Actor ID and Apify connection.",
      };
    }
  }

  const actor = await prisma.apifyActor.create({
    data: {
      actorId,
      displayName,
      description,
      platform: String(formData.get("platform") || "") || null,
      category: String(formData.get("category") || "") || null,
      sourceType: String(formData.get("sourceType") || formData.get("platform") || "") || null,
      inputSchema: inputSchema as Prisma.InputJsonValue,
    },
  });
  await writeAudit({ action: "actor.create", entity: "apify_actor", entityId: actor.id, payload: { actorId } });
  refresh(actor.id);
  return { id: actor.id };
}

export async function updateActor(actorId: string, formData: FormData) {
  await prisma.apifyActor.update({
    where: { id: actorId },
    data: {
      displayName: String(formData.get("displayName") || "").trim(),
      description: String(formData.get("description") || "") || null,
      platform: String(formData.get("platform") || "") || null,
      category: String(formData.get("category") || "") || null,
    },
  });
  refresh(actorId);
}

export async function saveActorInput(actorId: string, values: Record<string, unknown>) {
  await prisma.apifyActor.update({
    where: { id: actorId },
    data: { inputValues: values as Prisma.InputJsonValue },
  });
  refresh(actorId);
}

export async function saveActorMapping(actorId: string, mapping: OutputMapping) {
  const mappingIssues = validateOutputMapping(mapping);
  if (mappingIssues.length) return { error: mappingIssues[0]?.message };
  await prisma.apifyActor.update({
    where: { id: actorId },
    data: { outputMapping: mapping as Prisma.InputJsonValue },
  });
  refresh(actorId);
  return { ok: true };
}

export async function saveManualFields(
  actorId: string,
  fields: { name: string; title: string; type: string }[],
) {
  await prisma.apifyActor.update({
    where: { id: actorId },
    data: { manualFields: fields as Prisma.InputJsonValue },
  });
  refresh(actorId);
}

export async function refreshActorSchema(actorId: string) {
  const actor = await prisma.apifyActor.findUnique({ where: { id: actorId } });
  if (!actor) return { error: "Actor not found" };
  try {
    const meta = await new ApifyService().getActorMeta(actor.actorId);
    await prisma.apifyActor.update({
      where: { id: actorId },
      data: {
        inputSchema: (meta.inputSchema ?? {}) as Prisma.InputJsonValue,
        description: actor.description || meta.description,
      },
    });
    refresh(actorId);
    return { ok: true, fields: schemaToFields(meta.inputSchema) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Schema refresh failed" };
  }
}

export async function setActorActive(actorId: string, active: boolean) {
  await prisma.apifyActor.update({ where: { id: actorId }, data: { active } });
  refresh(actorId);
}

export async function deleteActor(actorId: string) {
  await prisma.apifyActor.delete({ where: { id: actorId } });
  await writeAudit({ action: "actor.delete", entity: "apify_actor", entityId: actorId });
  refresh();
}

export async function testActorAction(actorId: string) {
  const task = await enqueue({
    type: "RUN_APIFY_ACTOR",
    payload: { apifyActorId: actorId, testMode: true, ingest: true, pipeline: false },
    timeoutMs: 180_000,
  });
  const [done] = await processQueue(1);
  refresh(actorId);
  const report = (done && "output" in done ? done.output : null) as {
    actorName?: string;
    actorId?: string;
    status?: string;
    runId?: string | null;
    datasetId?: string | null;
    items?: number;
    preview?: unknown[];
    leadsCreated?: number;
    duplicates?: number;
    excluded?: number;
    sent?: number;
    error?: string | null;
  } | null;
  return {
    taskId: task.id,
    actorName: report?.actorName ?? "Actor",
    actorId: report?.actorId ?? "",
    status: report?.status ?? (done?.status === "FAILED" ? "FAILED" : "RUNNING"),
    runId: report?.runId ?? null,
    datasetId: report?.datasetId ?? null,
    items: report?.items ?? 0,
    preview: report?.preview ?? [],
    leadsCreated: report?.leadsCreated ?? 0,
    duplicates: report?.duplicates ?? 0,
    excluded: report?.excluded ?? 0,
    sent: 0 as const,
    error: report?.error ?? ("error" in (done ?? {}) ? (done as { error?: string }).error : null) ?? null,
  };
}

export async function runActorAction(actorId: string) {
  const task = await enqueue({
    type: "RUN_APIFY_ACTOR",
    payload: { apifyActorId: actorId, testMode: false, ingest: true, pipeline: false },
    timeoutMs: 240_000,
  });
  refresh(actorId);
  return { taskId: task.id, runId: task.id };
}

export async function listLeadScrapeActors() {
  return prisma.apifyActor.findMany({
    where: { active: true },
    orderBy: [{ lastRunAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true, displayName: true, actorId: true },
  });
}

export async function runLeadScrapeAction(actorId: string) {
  const result = await testActorAction(actorId);
  if ((result.leadsCreated ?? 0) > 0) {
    const { markSheetBatchFresh } = await import("@/lib/google/sheet-batch-store");
    await markSheetBatchFresh();
  }
  const { syncLeadsWorkbook } = await import("@/lib/google/sync");
  const sheet = await syncLeadsWorkbook();
  refresh(actorId);
  if (!result.error && !sheet.ok) {
    return { ...result, error: sheet.message, sheet };
  }
  return { ...result, sheet };
}

export async function syncActorRunAction(runId: string) {
  const run = await syncStandaloneActorRun(runId);
  if (run) refresh(run.apifyActorId);
  return run;
}

export async function guessMappingFromLastRun(actorId: string) {
  const run = await prisma.actorRun.findFirst({
    where: { apifyActorId: actorId, datasetId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!run?.datasetId) return { error: "Run a test first so Jarvis can see output keys." };
  const { getActorProvider } = await import("@/lib/actors/registry");
  const items = await getActorProvider(run.provider).results(run.datasetId, 5);
  const keys = collectKeys(items);
  const mapping = guessMapping(keys);
  return { keys, mapping, sample: items[0] ?? null };
}
