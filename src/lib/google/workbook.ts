/** Optional default Google Sheet (set GOOGLE_SHEET_ID). Empty = connect one in Settings. */
export const DEFAULT_WORKBOOK_ID = (process.env.GOOGLE_SHEET_ID ?? "").trim();
export const DEFAULT_WORKBOOK_URL = DEFAULT_WORKBOOK_ID
  ? `https://docs.google.com/spreadsheets/d/${DEFAULT_WORKBOOK_ID}/edit`
  : "";

export function spreadsheetEditUrl(spreadsheetId: string, gid?: number | null) {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (typeof gid !== "number") return base;
  return `${base}?gid=${gid}#gid=${gid}`;
}

export const PLATFORM_SHEETS = [
  {
    key: "leads",
    title: "Leads",
    purpose: "Marketing lead intake for the research pipeline",
    importable: true,
  },
  {
    key: "upwork",
    title: "Upwork",
    purpose: "Upwork listings Jarvis can score and draft from",
    importable: true,
  },
  {
    key: "fiverr",
    title: "Fiverr",
    purpose: "Fiverr gigs and buyer inquiries (record_type column)",
    importable: true,
  },
  {
    key: "linkedin",
    title: "LinkedIn",
    purpose: "Reserved tab. No LinkedIn agent is wired yet.",
    importable: false,
  },
] as const;

/** Cold-emailed / already-reached leads move here so Leads stays unused-only. */
export const USED_ALREADY_WORKSHEET = "Used already";

export type PlatformSheetKey = (typeof PLATFORM_SHEETS)[number]["key"];

export const SHEET_HEADERS: Record<PlatformSheetKey, string[]> = {
  leads: [
    "Name",
    "Company",
    "Website",
    "Email",
    "Phone",
    "LinkedIn",
    "Instagram",
    "Facebook",
    "Twitter",
    "Source",
    "Industry",
    "Location",
    "Original post",
    "Notes",
    "Test recipient",
    "Lead ID",
    "Outreach status",
    "Sent at",
    "Sent channel",
  ],
  upwork: [
    "external_id",
    "title",
    "description",
    "url",
    "client_name",
    "budget",
    "budget_type",
    "skills",
    "posted_at",
    "location",
    "notes",
  ],
  fiverr: [
    "record_type",
    "title",
    "description",
    "url",
    "buyer_name",
    "keywords",
    "message",
    "notes",
  ],
  linkedin: ["name", "company", "website", "linkedin_url", "title", "notes"],
};

export type WorkbookConfig = {
  spreadsheetId: string;
  worksheets: Record<PlatformSheetKey, string>;
  columnMap: Record<string, string>;
};

export function defaultWorksheets(): Record<PlatformSheetKey, string> {
  return {
    leads: "Leads",
    upwork: "Upwork",
    fiverr: "Fiverr",
    linkedin: "LinkedIn",
  };
}

export function extractSpreadsheetId(value: string) {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (match?.[1] ?? value).trim();
}

export function parseWorkbookConfig(raw: unknown): WorkbookConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const config = raw as Record<string, unknown>;
  const spreadsheetId = extractSpreadsheetId(String(config.spreadsheetId ?? ""));
  if (!spreadsheetId) return null;
  const named = (config.worksheets ?? {}) as Partial<Record<PlatformSheetKey, string>>;
  const worksheets = defaultWorksheets();
  for (const sheet of PLATFORM_SHEETS) {
    const value = named[sheet.key];
    if (typeof value === "string" && value.trim()) worksheets[sheet.key] = value.trim();
  }
  if (typeof config.worksheet === "string" && config.worksheet.trim()) {
    worksheets.leads = config.worksheet.trim();
  }
  const columnMap = {
    ...identityLeadMap(),
    ...(config.columnMap && typeof config.columnMap === "object"
      ? (config.columnMap as Record<string, string>)
      : {}),
  };
  return { spreadsheetId, worksheets, columnMap };
}

export type SheetLeadRow = {
  name?: string | null;
  company?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  source?: string | null;
  industry?: string | null;
  location?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  testRecipient?: boolean | null;
  leadId?: string | null;
  outreachStatus?: string | null;
  sentAt?: string | null;
  sentChannel?: string | null;
};

function cell(value?: string | null) {
  return value ?? "";
}

export function leadsToSheetRows(leads: SheetLeadRow[]): string[][] {
  return [
    SHEET_HEADERS.leads,
    ...leads.map((lead) => [
      cell(lead.name),
      cell(lead.company),
      cell(lead.website),
      cell(lead.email),
      cell(lead.phone),
      cell(lead.linkedinUrl),
      cell(lead.instagramUrl),
      cell(lead.facebookUrl),
      cell(lead.twitterUrl),
      cell(lead.source),
      cell(lead.industry),
      cell(lead.location),
      cell(lead.originalPost),
      cell(lead.notes),
      lead.testRecipient ? "true" : "",
      cell(lead.leadId),
      cell(lead.outreachStatus),
      cell(lead.sentAt),
      cell(lead.sentChannel),
    ]),
  ];
}

export function websiteHostKey(website?: string | null) {
  if (!website?.trim()) return "";
  try {
    const url = new URL(website.includes("://") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return website.trim().toLowerCase();
  }
}

function headerIndex(headers: string[], name: string) {
  const needle = name.toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === needle);
}

export function ensureLeadSheetHeaders(headers: string[]) {
  const next = headers.map((header) => header.trim()).filter(Boolean);
  if (!next.length) return [...SHEET_HEADERS.leads];
  for (const header of SHEET_HEADERS.leads) {
    if (headerIndex(next, header) < 0) next.push(header);
  }
  return next;
}

function rowRecord(headers: string[], row: string[]) {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = (row[index] ?? "").trim();
  });
  return record;
}

function identityKeys(input: { leadId?: string | null; email?: string | null; website?: string | null }) {
  const keys: string[] = [];
  if (input.leadId?.trim()) keys.push(`id:${input.leadId.trim()}`);
  if (input.email?.trim()) keys.push(`email:${input.email.trim().toLowerCase()}`);
  const host = websiteHostKey(input.website);
  if (host) keys.push(`web:${host}`);
  return keys;
}

export function mergeLeadRowsIntoSheet(
  existingRows: string[][],
  leads: SheetLeadRow[],
  options?: {
    remove?: Array<{ leadId?: string | null; email?: string | null; website?: string | null }>;
  },
) {
  const headers = ensureLeadSheetHeaders(existingRows[0] ?? []);
  const removeKeys = new Set<string>();
  for (const lead of options?.remove ?? []) {
    for (const key of identityKeys(lead)) removeKeys.add(key);
  }

  let removed = 0;
  const data = existingRows
    .slice(1)
    .map((row) => {
      const padded = row.map((cell) => cell ?? "");
      while (padded.length < headers.length) padded.push("");
      return padded;
    })
    .filter((row) => {
      if (!removeKeys.size) return true;
      const record = rowRecord(headers, row);
      const keys = identityKeys({
        leadId: record["Lead ID"],
        email: record.Email,
        website: record.Website,
      });
      if (keys.some((key) => removeKeys.has(key))) {
        removed += 1;
        return false;
      }
      return true;
    });

  const lookup = new Map<string, number>();
  const indexRow = (index: number) => {
    const record = rowRecord(headers, data[index] ?? []);
    for (const key of identityKeys({
      leadId: record["Lead ID"],
      email: record.Email,
      website: record.Website,
    })) {
      if (!lookup.has(key)) lookup.set(key, index);
    }
  };
  data.forEach((_, index) => indexRow(index));

  const setCell = (row: string[], header: string, value: string) => {
    const index = headerIndex(headers, header);
    if (index >= 0 && value) row[index] = value;
  };
  const writeLead = (row: string[], lead: SheetLeadRow) => {
    setCell(row, "Name", cell(lead.name));
    setCell(row, "Company", cell(lead.company));
    setCell(row, "Website", cell(lead.website));
    setCell(row, "Email", cell(lead.email));
    setCell(row, "Phone", cell(lead.phone));
    setCell(row, "LinkedIn", cell(lead.linkedinUrl));
    setCell(row, "Instagram", cell(lead.instagramUrl));
    setCell(row, "Facebook", cell(lead.facebookUrl));
    setCell(row, "Twitter", cell(lead.twitterUrl));
    setCell(row, "Source", cell(lead.source));
    setCell(row, "Industry", cell(lead.industry));
    setCell(row, "Location", cell(lead.location));
    setCell(row, "Original post", cell(lead.originalPost));
    setCell(row, "Notes", cell(lead.notes));
    if (lead.testRecipient) setCell(row, "Test recipient", "true");
    setCell(row, "Lead ID", cell(lead.leadId));
    const statusIndex = headerIndex(headers, "Outreach status");
    if (statusIndex >= 0) row[statusIndex] = cell(lead.outreachStatus);
    setCell(row, "Sent at", cell(lead.sentAt));
    setCell(row, "Sent channel", cell(lead.sentChannel));
  };

  let appended = 0;
  let sentMarked = 0;
  let updated = 0;
  for (const lead of leads) {
    const keys = identityKeys(lead);
    if (keys.some((key) => removeKeys.has(key))) continue;
    let found = -1;
    for (const key of keys) {
      const index = lookup.get(key);
      if (index !== undefined) {
        found = index;
        break;
      }
    }
    if (found < 0) {
      const row = headers.map(() => "");
      writeLead(row, lead);
      data.push(row);
      appended += 1;
      if (lead.outreachStatus === "SENT") sentMarked += 1;
      indexRow(data.length - 1);
      continue;
    }
    const statusIndex = headerIndex(headers, "Outreach status");
    const previous = (data[found]?.[statusIndex] ?? "").trim().toUpperCase();
    writeLead(data[found], lead);
    updated += 1;
    if (lead.outreachStatus === "SENT" && previous !== "SENT") sentMarked += 1;
  }

  return { rows: [headers, ...data], appended, sentMarked, updated, removed, total: data.length };
}

export function identityLeadMap(): Record<string, string> {
  return {
    name: "Name",
    company: "Company",
    website: "Website",
    email: "Email",
    phone: "Phone",
    linkedinUrl: "LinkedIn",
    instagramUrl: "Instagram",
    facebookUrl: "Facebook",
    twitterUrl: "Twitter",
    source: "Source",
    location: "Location",
    industry: "Industry",
    originalPost: "Original post",
    notes: "Notes",
    testRecipient: "Test recipient",
  };
}

export function rowsToRecords(rows: string[][]) {
  const headers = (rows[0] ?? []).map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (row[index] ?? "").trim();
    });
    return record;
  });
}

export function limitWorksheetRows(rows: string[][], maxRows?: number) {
  if (maxRows === undefined) return rows;
  return rows.slice(0, Math.max(1, maxRows) + 1);
}

export function pick(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value) return value;
  }
  return "";
}
