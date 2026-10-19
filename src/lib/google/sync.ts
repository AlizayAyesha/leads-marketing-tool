import "server-only";

import { prisma } from "@/lib/db/prisma";
import { GoogleAdapter, exportEnrichedRows, readWorksheet, readWorksheetDetailed } from "@/lib/data-sources/google";
import { ensureWorksheet } from "@/lib/google/provision";
import { IntakeAgent } from "@/lib/agents/intake";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import type { ColumnMap } from "@/types";
import { IntegrationPendingError } from "@/lib/data-sources/types";
import { GoogleSheetsError } from "@/lib/google/sheets-client";
import { tableToLeadInputs } from "@/lib/browser/sheets";
import {
  parseWorkbookConfig,
  pick,
  rowsToRecords,
  mergeLeadRowsIntoSheet,
  spreadsheetEditUrl,
  USED_ALREADY_WORKSHEET,
  SHEET_HEADERS,
  type PlatformSheetKey,
  type SheetLeadRow,
  type WorkbookConfig,
} from "@/lib/google/workbook";
import { isColdEmailReachedOut } from "@/lib/google/sheet-cold-email";
import {
  fingerprintSheetIdentities,
  isSheetBatchExhausted,
  OLD_SCRAPE_DONE_MESSAGE,
} from "@/lib/google/sheet-batch";
import { getSheetBatch, markSheetBatchFresh, recordSheetImport } from "@/lib/google/sheet-batch-store";
import { setSetting } from "@/lib/db/settings";

type SheetConfig = WorkbookConfig & {
  worksheet: string;
  sourceId?: string;
};

export async function getSheetConfig(): Promise<SheetConfig | null> {
  const source = await prisma.leadSource.findFirst({
    where: { type: "GOOGLE_SHEETS" },
    orderBy: { updatedAt: "desc" },
  });
  if (!source) return null;
  const parsed = parseWorkbookConfig(source.config);
  if (!parsed) return null;
  return {
    ...parsed,
    worksheet: parsed.worksheets.leads,
    sourceId: source.id,
  };
}

export async function importFromConfiguredSheet(options: { limit?: number; reuseSheet?: boolean } = {}) {
  const config = await getSheetConfig();
  if (!config) {
    return {
      pending: true,
      exhausted: false,
      message: "No Google Sheet is configured. Connect one in Settings. CSV and manual intake still work.",
      sourceOfTruth: "postgresql",
      workspace: "google-sheets",
    };
  }

  let leads: Awaited<ReturnType<GoogleAdapter["acquire"]>>["data"] | null = null;
  let via: "google-api" | "chrome" = "google-api";
  const adapter = new GoogleAdapter();
  try {
    const acquired = await adapter.acquire({
      spreadsheetId: config.spreadsheetId,
      worksheet: config.worksheets.leads,
      columnMap: config.columnMap as ColumnMap,
      maxRows: options.limit,
    });
    leads = acquired.data;
  } catch (error) {
    if (error instanceof GoogleSheetsError) throw error;
    if (!(error instanceof IntegrationPendingError)) throw error;
    const browserRows = await readSheetViaChrome(config.spreadsheetId, config.worksheets.leads);
    if (!browserRows) {
      return {
        pending: true,
        exhausted: false,
        message:
          error.message +
          " Jarvis Chrome can read the sheet after you connect it from Integrations → Chrome. CSV/manual intake still work.",
        sourceOfTruth: "postgresql",
        workspace: "google-sheets",
      };
    }
    leads = options.limit ? browserRows.slice(0, options.limit) : browserRows;
    via = "chrome";
  }

  if (!leads) {
    return {
      pending: true,
      exhausted: false,
      message: "Sheet had no rows Jarvis could read.",
      sourceOfTruth: "postgresql",
      workspace: "google-sheets",
    };
  }

  const intake = new IntakeAgent();
  const result = await intake.execute({
    prompt: DEFAULT_PROMPTS.intake.content,
    payload: {
      leads,
      sourceId: config.sourceId,
      sourceName: via === "chrome" ? "google-sheets-browser" : "google-sheets",
    },
  });
  await prisma.leadSource.update({
    where: { id: config.sourceId },
    data: { lastSyncedAt: new Date() },
  });
  const output = (result.output ?? {}) as {
    stored?: number;
    duplicates?: number;
    leadIds?: string[];
    message?: string;
  };
  const stored = Number(output.stored ?? 0);
  const duplicates = Number(output.duplicates ?? 0);
  const fingerprint = fingerprintSheetIdentities(leads);
  const previous = await getSheetBatch();
  const exhausted = isSheetBatchExhausted({
    previous,
    fingerprint,
    stored,
    duplicates,
    reuse: options.reuseSheet,
  });
  await recordSheetImport({
    fingerprint,
    stored,
    duplicates,
    leadCount: leads.length,
  });
  return {
    ...output,
    stored,
    duplicates,
    via,
    exhausted,
    fingerprint,
    sourceOfTruth: "postgresql",
    workspace: "google-sheets",
    message: exhausted
      ? OLD_SCRAPE_DONE_MESSAGE
      : stored > 0
        ? `Imported ${stored} new lead${stored === 1 ? "" : "s"} from the sheet (${duplicates} already in Jarvis).`
        : duplicates > 0
          ? `Sheet already in Jarvis (${duplicates} existing). No new scraped rows.`
          : output.message ?? "Sheet import finished.",
  };
}

async function readSheetViaChrome(spreadsheetId: string, worksheet: string) {
  const { getChromeSession, performBrowserCommand } = await import("@/lib/tools/chrome");
  if (getChromeSession().status !== "CONNECTED") return null;
  const result = await performBrowserCommand({
    action: "sheet_read",
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    spreadsheetId,
    worksheet,
  });
  if (!result.ok || !result.evidence?.tables?.length) return null;
  return tableToLeadInputs(result.evidence.tables);
}

const SENT_EVENT_TYPES = [
  "SENT",
  "LINKEDIN_MESSAGE_SENT",
  "LINKEDIN_CONNECTION_SENT",
  "TWITTER_DM_SENT",
];

export const SHEET_SYNC_KEY = "sheet.sync.latest";

export type SheetSyncResult = {
  ok: boolean;
  pending: boolean;
  appended: number;
  sentMarked: number;
  removedColdEmail: number;
  movedToUsed: number;
  updated: number;
  exported: number;
  spreadsheetId: string | null;
  url: string | null;
  message: string;
  at?: string;
};

function sheetFail(message: string, extra: Partial<SheetSyncResult> = {}): SheetSyncResult {
  return {
    ok: false,
    pending: extra.pending ?? false,
    appended: 0,
    sentMarked: 0,
    removedColdEmail: 0,
    movedToUsed: 0,
    updated: 0,
    exported: 0,
    spreadsheetId: extra.spreadsheetId ?? null,
    url: extra.url ?? null,
    message,
    at: new Date().toISOString(),
  };
}

export async function syncLeadsWorkbook(): Promise<SheetSyncResult> {
  const config = await getSheetConfig();
  if (!config) {
    const result = sheetFail(
      "No Google Sheet is configured. Connect one in Integrations → Sheets. Done waits until new leads and SENT rows are written there.",
      { pending: true },
    );
    await setSetting(SHEET_SYNC_KEY, result).catch(() => null);
    return result;
  }

  try {
    await ensureWorksheet(config.spreadsheetId, config.worksheets.leads);
    const existing = await readWorksheet(config.spreadsheetId, config.worksheets.leads);
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        drafts: { orderBy: { updatedAt: "desc" }, take: 8 },
        events: {
          where: { type: { in: SENT_EVENT_TYPES } },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { draft: { select: { stepKind: true } } },
        },
      },
    });

    const coldEmailed = leads.filter((lead) =>
      isColdEmailReachedOut({
        drafts: lead.drafts,
        events: lead.events.map((event) => ({
          type: event.type,
          channel: event.channel,
          draftStepKind: event.draft?.stepKind ?? null,
        })),
      }),
    );

    const usedSheetRows: SheetLeadRow[] = coldEmailed.map((lead) => {
      const sentEvent = lead.events.find((event) => event.type === "SENT" && event.channel === "EMAIL") ?? lead.events[0];
      const sentDraft = lead.drafts.find((draft) => draft.status === "SENT" && draft.channel === "EMAIL");
      return {
        name: lead.name,
        company: lead.company,
        website: lead.website,
        email: lead.email,
        phone: lead.phone,
        linkedinUrl: lead.linkedinUrl,
        instagramUrl: lead.instagramUrl,
        facebookUrl: lead.facebookUrl,
        twitterUrl: lead.twitterUrl,
        source: lead.source,
        industry: lead.industry,
        location: lead.location,
        originalPost: lead.originalPost,
        notes: lead.notes,
        testRecipient: lead.testRecipient,
        leadId: lead.leadId,
        outreachStatus: "SENT",
        sentAt: sentEvent?.createdAt.toISOString() ?? (sentDraft ? sentDraft.updatedAt.toISOString() : ""),
        sentChannel: String(sentEvent?.channel ?? sentDraft?.channel ?? "EMAIL"),
      };
    });

    let movedToUsed = 0;
    if (usedSheetRows.length > 0) {
      await ensureWorksheet(config.spreadsheetId, USED_ALREADY_WORKSHEET);
      const existingUsed = await readWorksheet(config.spreadsheetId, USED_ALREADY_WORKSHEET);
      const usedBase =
        existingUsed.length > 0 ? existingUsed : [SHEET_HEADERS.leads.map((header) => header)];
      const usedMerged = mergeLeadRowsIntoSheet(usedBase, usedSheetRows);
      await exportEnrichedRows({
        spreadsheetId: config.spreadsheetId,
        worksheet: USED_ALREADY_WORKSHEET,
        rows: usedMerged.rows,
      });
      movedToUsed = usedMerged.appended + usedMerged.updated;
    }

    const mapped: SheetLeadRow[] = leads
      .filter((lead) => !coldEmailed.some((row) => row.id === lead.id))
      .map((lead) => {
        const sentEvent = lead.events[0];
        const sentDraft = lead.drafts.find((draft) => draft.status === "SENT");
        const draft = sentDraft ?? lead.drafts[0];
        const sent = Boolean(sentEvent || sentDraft);
        return {
          name: lead.name,
          company: lead.company,
          website: lead.website,
          email: lead.email,
          phone: lead.phone,
          linkedinUrl: lead.linkedinUrl,
          instagramUrl: lead.instagramUrl,
          facebookUrl: lead.facebookUrl,
          twitterUrl: lead.twitterUrl,
          source: lead.source,
          industry: lead.industry,
          location: lead.location,
          originalPost: lead.originalPost,
          notes: lead.notes,
          testRecipient: lead.testRecipient,
          leadId: lead.leadId,
          outreachStatus: sent ? "SENT" : draft ? "DRAFT" : "NOT_SENT",
          sentAt: sentEvent?.createdAt.toISOString() ?? (sentDraft ? sentDraft.updatedAt.toISOString() : ""),
          sentChannel: String(sentEvent?.channel ?? sentDraft?.channel ?? ""),
        };
      });

    const merged = mergeLeadRowsIntoSheet(existing, mapped, {
      remove: coldEmailed.map((lead) => ({
        leadId: lead.leadId,
        email: lead.email,
        website: lead.website,
      })),
    });
    const primaryName = config.worksheets.leads;
    const targets = [...new Set([primaryName, "Sheet1", "Leads"])];
    let primaryGid: number | null = null;
    for (const worksheet of targets) {
      const tab = await ensureWorksheet(config.spreadsheetId, worksheet, {
        bringToFront: worksheet === primaryName,
      });
      if (worksheet === primaryName) primaryGid = tab.sheetId;
      await exportEnrichedRows({
        spreadsheetId: config.spreadsheetId,
        worksheet,
        rows: merged.rows,
      });
    }
    const verified = await readWorksheetDetailed(config.spreadsheetId, primaryName);
    if (mapped.length > 0 && verified.dataRowCount < 1) {
      const url = spreadsheetEditUrl(config.spreadsheetId, primaryGid);
      const result = sheetFail(
        `Google write returned no rows on the ${primaryName} tab. Open that tab (not the first sheet): ${url}`,
        { spreadsheetId: config.spreadsheetId, url },
      );
      await setSetting(SHEET_SYNC_KEY, result).catch(() => null);
      return result;
    }
    if (merged.appended > 0) await markSheetBatchFresh();
    if (config.sourceId) {
      await prisma.leadSource.update({
        where: { id: config.sourceId },
        data: { lastSyncedAt: new Date() },
      });
    }
    const url = spreadsheetEditUrl(config.spreadsheetId, primaryGid);
    const result: SheetSyncResult = {
      ok: true,
      pending: false,
      appended: merged.appended,
      sentMarked: merged.sentMarked,
      removedColdEmail: coldEmailed.length,
      movedToUsed,
      updated: merged.updated,
      exported: verified.dataRowCount,
      spreadsheetId: config.spreadsheetId,
      url,
      message: `Leads tab: ${verified.dataRowCount} unused row${verified.dataRowCount === 1 ? "" : "s"}. Moved ${movedToUsed} used lead${movedToUsed === 1 ? "" : "s"} → "${USED_ALREADY_WORKSHEET}". Removed ${merged.removed} from Leads after cold email. ${merged.appended} new unused. Open: ${url}`,
      at: new Date().toISOString(),
    };
    await setSetting(SHEET_SYNC_KEY, result);
    return result;
  } catch (error) {
    const result = sheetFail(
      error instanceof Error ? error.message : "Google Sheet update failed.",
      {
        spreadsheetId: config.spreadsheetId,
        url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
      },
    );
    await setSetting(SHEET_SYNC_KEY, result).catch(() => null);
    return result;
  }
}

export async function getLatestSheetSync() {
  const { getSetting } = await import("@/lib/db/settings");
  return getSetting<SheetSyncResult | null>(SHEET_SYNC_KEY, null);
}

export async function exportEnrichedSheet() {
  const config = await getSheetConfig();
  if (!config) {
    return {
      pending: true,
      message: "No Google Sheet is configured. Connect one in Settings.",
    };
  }

  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      research: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const header = [
    "lead_id",
    "name",
    "company",
    "website",
    "email",
    "qualification_score",
    "lead_status",
    "industry",
    "website_quality",
    "identified_problem",
    "opportunity",
    "recommended_service",
    "evidence",
    "recommended_channel",
    "message_draft",
    "follow_up_date",
    "outreach_status",
  ];

  const rows = [
    header,
    ...leads.map((lead) => [
      lead.leadId,
      lead.name,
      lead.company,
      lead.website,
      lead.email,
      lead.scores[0]?.score ?? "",
      lead.status,
      lead.industry,
      lead.research[0]?.websiteQuality ?? "",
      lead.opportunities[0]?.problem ?? "",
      lead.opportunities[0]?.suggestedOffer ?? "",
      lead.opportunities[0]?.recommendedService ?? "",
      lead.opportunities[0]?.evidence ?? "",
      lead.drafts[0]?.channel ?? "",
      lead.drafts[0]?.message ?? "",
      "",
      lead.drafts[0]?.status ?? "",
    ]),
  ];

  const exportTab = `${config.worksheets.leads} Export`;
  await ensureWorksheet(config.spreadsheetId, exportTab);
  await exportEnrichedRows({
    spreadsheetId: config.spreadsheetId,
    worksheet: exportTab,
    rows,
  });

  return { exported: leads.length };
}

export async function exportLeadsToLeadsTab() {
  const result = await syncLeadsWorkbook();
  return {
    ok: result.ok,
    pending: result.pending,
    exported: result.exported,
    url: result.url,
    message: result.message,
  };
}

export async function readPlatformSheet(platform: PlatformSheetKey) {
  const config = await getSheetConfig();
  if (!config) {
    return { ok: false as const, error: "No Google workbook is configured." };
  }
  const worksheet = config.worksheets[platform];
  const rows = await readWorksheet(config.spreadsheetId, worksheet);
  return {
    ok: true as const,
    spreadsheetId: config.spreadsheetId,
    worksheet,
    records: rowsToRecords(rows),
  };
}

export function upworkRecordToPayload(record: Record<string, string>) {
  return {
    externalId: pick(record, "external_id", "id"),
    title: pick(record, "title"),
    description: pick(record, "description"),
    url: pick(record, "url"),
    clientName: pick(record, "client_name", "client"),
    budget: pick(record, "budget"),
    budgetType: pick(record, "budget_type"),
    skills: pick(record, "skills"),
    location: pick(record, "location"),
    notes: pick(record, "notes"),
  };
}

export function fiverrRecordToPayload(record: Record<string, string>) {
  const kind = pick(record, "record_type", "type").toLowerCase();
  const message = pick(record, "message");
  const isInquiry = kind === "inquiry" || kind === "buyer" || (!kind && Boolean(message));
  return {
    kind: isInquiry ? "inquiry" : "gig",
    title: pick(record, "title"),
    description: pick(record, "description"),
    url: pick(record, "url"),
    buyerName: pick(record, "buyer_name", "buyer"),
    keywords: pick(record, "keywords"),
    message,
    notes: pick(record, "notes"),
  };
}
