"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import type { ColumnMap } from "@/types";
import {
  defaultWorksheets,
  extractSpreadsheetId,
  identityLeadMap,
  DEFAULT_WORKBOOK_ID,
} from "@/lib/google/workbook";
import { provisionPlatformWorkbook } from "@/lib/google/provision";
import { IntegrationPendingError } from "@/lib/data-sources/types";

function refreshSheets() {
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/integrations");
  revalidatePath("/integrations/sheets");
  revalidatePath("/freelance");
}

export async function saveSheetSource(input: {
  name: string;
  spreadsheetId: string;
  worksheet?: string;
  columnMap?: ColumnMap;
}) {
  const spreadsheetId = extractSpreadsheetId(input.spreadsheetId) || DEFAULT_WORKBOOK_ID;
  const worksheets = defaultWorksheets();
  if (input.worksheet) worksheets.leads = input.worksheet;
  const existing = await prisma.leadSource.findFirst({
    where: { type: "GOOGLE_SHEETS" },
  });
  const data = {
    name: input.name,
    type: "GOOGLE_SHEETS" as const,
    config: {
      spreadsheetId,
      worksheet: worksheets.leads,
      worksheets,
      columnMap: input.columnMap ?? identityLeadMap(),
    },
  };
  if (existing) {
    await prisma.leadSource.update({ where: { id: existing.id }, data });
  } else {
    await prisma.leadSource.create({ data });
  }
  await writeAudit({ action: "sheets.configure", entity: "lead_source" });
  refreshSheets();
}

export async function saveWorkbookSource(formData: FormData) {
  await saveSheetSource({
    name: String(formData.get("name") || "Leads Marketing Tool workbook"),
    spreadsheetId: String(formData.get("spreadsheetId") || DEFAULT_WORKBOOK_ID),
  });
}

export async function provisionWorkbookAction() {
  const source = await prisma.leadSource.findFirst({
    where: { type: "GOOGLE_SHEETS" },
    orderBy: { updatedAt: "desc" },
  });
  const spreadsheetId =
    extractSpreadsheetId(String((source?.config as { spreadsheetId?: string } | null)?.spreadsheetId ?? "")) ||
    DEFAULT_WORKBOOK_ID;
  try {
    const result = await provisionPlatformWorkbook(spreadsheetId);
    await saveSheetSource({
      name: source?.name || "Leads Marketing Tool workbook",
      spreadsheetId,
    });
    await writeAudit({ action: "sheets.provision", entity: "lead_source" });
    refreshSheets();
    return { ok: true as const, result };
  } catch (error) {
    const message =
      error instanceof IntegrationPendingError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not provision worksheets.";
    return { ok: false as const, error: message };
  }
}

export async function pushLeadsToSheetAction() {
  try {
    const { exportLeadsToLeadsTab } = await import("@/lib/google/sync");
    const result = await exportLeadsToLeadsTab();
    await writeAudit({
      action: "sheets.push_leads",
      entity: "lead_source",
      payload: { exported: result.exported },
    });
    refreshSheets();
    revalidatePath("/leads");
    return result;
  } catch (error) {
    const message =
      error instanceof IntegrationPendingError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not push leads to Google Sheets.";
    return { ok: false as const, pending: true, exported: 0, message };
  }
}

export async function disconnectGoogleAction() {
  await prisma.googleConnection.deleteMany();
  await writeAudit({ action: "google.disconnected", entity: "integration" });
  refreshSheets();
  return { ok: true as const };
}

export async function saveBusinessPolicyAction(formData: FormData) {
  const { getBusinessPolicy, saveBusinessPolicy } = await import("@/lib/config/business-store");
  const current = await getBusinessPolicy();
  const industries = String(formData.get("industries") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const geographies = String(formData.get("geographies") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await saveBusinessPolicy({
    ...current,
    icp: {
      ...current.icp,
      industries,
      geographies,
      jobTitles: String(formData.get("jobTitles") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      companySize: String(formData.get("companySize") || ""),
      notes: String(formData.get("icpNotes") || current.icp.notes),
    },
    scoring: {
      fit: Number(formData.get("fit") || current.scoring.fit),
      need: Number(formData.get("need") || current.scoring.need),
      intent: Number(formData.get("intent") || current.scoring.intent),
      timing: Number(formData.get("timing") || current.scoring.timing),
      accessibility: Number(formData.get("accessibility") || current.scoring.accessibility),
    },
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function savePrompt(agentSlug: string, content: string) {
  const current = await prisma.prompt.findUnique({ where: { agentSlug } });
  await prisma.prompt.upsert({
    where: { agentSlug },
    update: { content, version: (current?.version ?? 1) + 1 },
    create: { agentSlug, name: agentSlug, content },
  });
  revalidatePath("/agents");
}

export async function addSuppression(formData: FormData) {
  const email = String(formData.get("email") || "").toLowerCase() || null;
  const domain = String(formData.get("domain") || "") || null;
  const phone = String(formData.get("phone") || "") || null;
  if (!email && !domain && !phone) return;
  await prisma.suppression.create({
    data: { email, domain, phone, reason: "operator" },
  });
  revalidatePath("/settings");
}

export async function createCampaign(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await prisma.campaign.create({
    data: {
      name,
      description: String(formData.get("description") || "") || null,
    },
  });
  revalidatePath("/campaigns");
}
