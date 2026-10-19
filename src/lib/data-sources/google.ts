import "server-only";

import { google } from "googleapis";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import type { ColumnMap, RawLeadInput } from "@/types";
import {
  IntegrationPendingError,
  type DataSourceAdapter,
  type DataSourceResult,
} from "@/lib/data-sources/types";
import { limitWorksheetRows } from "@/lib/google/workbook";
import {
  GoogleSheetsError,
  SHEETS_TIMEOUT_MS,
  callGoogleApi,
  coalesceInflight,
  connectionHasSheetsScope,
  parseValuesGetResponse,
  type SheetReadSuccess,
} from "@/lib/google/sheets-client";

export { GoogleSheetsError } from "@/lib/google/sheets-client";

const SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export const GMAIL_OUTREACH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export function googleOAuthClient() {
  const env = getEnv();
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new IntegrationPendingError(
      "GoogleAdapter",
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Google Sheets. CSV import still works without Google.",
    );
  }
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri,
  );
}

export function googleAuthUrl(options?: { gmailOutreach?: boolean; state?: string; senderOnly?: boolean }) {
  const client = googleOAuthClient();
  const scope = options?.senderOnly
    ? ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", ...GMAIL_OUTREACH_SCOPES]
    : options?.gmailOutreach
      ? [...SHEETS_SCOPES, ...GMAIL_OUTREACH_SCOPES]
      : SHEETS_SCOPES;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope,
    ...(options?.state ? { state: options.state } : {}),
  });
}

export async function storeGoogleTokens(code: string) {
  const client = googleOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();

  await prisma.googleConnection.deleteMany();
  await prisma.googleConnection.create({
    data: {
      googleEmail: profile.data.email ?? null,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ? tokens.scope.split(/\s+/) : SHEETS_SCOPES,
    },
  });

  return profile.data.email ?? null;
}

const inflightWorksheetReads = new Map<string, Promise<SheetReadSuccess>>();

export async function getGoogleClient() {
  const connection = await prisma.googleConnection.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new IntegrationPendingError(
      "GoogleAdapter",
      "Google account is not connected. Use Settings → Google Sheets.",
    );
  }
  if (!connectionHasSheetsScope(connection.scopes)) {
    throw new GoogleSheetsError(
      "UNAUTHORIZED",
      "Google connection is missing Sheets scope. Reconnect Google in Settings.",
      { retryable: false, status: 403 },
    );
  }
  const expired =
    Boolean(connection.tokenExpiry) && connection.tokenExpiry!.getTime() < Date.now() - 30_000;
  if (expired && !connection.refreshToken) {
    throw new GoogleSheetsError(
      "UNAUTHORIZED",
      "Google Sheets credentials are invalid or expired. Reconnect Google in Settings.",
      { retryable: false, status: 401 },
    );
  }
  const client = googleOAuthClient();
  client.setCredentials({
    access_token: connection.accessToken ?? undefined,
    refresh_token: connection.refreshToken ?? undefined,
    expiry_date: connection.tokenExpiry?.getTime(),
  });
  client.on("tokens", (tokens) => {
    void prisma.googleConnection
      .update({
        where: { id: connection.id },
        data: {
          accessToken: tokens.access_token ?? connection.accessToken,
          refreshToken: tokens.refresh_token ?? connection.refreshToken,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : connection.tokenExpiry,
        },
      })
      .catch(() => undefined);
  });
  return { client, connection };
}

export class GoogleAdapter
  implements
    DataSourceAdapter<
      { spreadsheetId: string; worksheet: string; columnMap: ColumnMap },
      RawLeadInput[]
    >
{
  readonly id = "google-sheets";
  readonly phase = 1 as const;
  readonly configured = Boolean(
    getEnv().googleClientId && getEnv().googleClientSecret,
  );

  async acquire(input: {
    spreadsheetId: string;
    worksheet: string;
    columnMap: ColumnMap;
    maxRows?: number;
  }): Promise<DataSourceResult<RawLeadInput[]>> {
    if (!this.configured) {
      throw new IntegrationPendingError(
        "GoogleAdapter",
        "Google OAuth client is not configured.",
      );
    }
    const sheet = await readWorksheetDetailed(input.spreadsheetId, input.worksheet);
    const leads = mapRows(sheet.rows, input.columnMap, input.maxRows);
    return {
      adapter: this.id,
      data: leads,
      sourceUrls: [
        `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
      ],
      message: sheet.message,
    };
  }
}

export async function listSpreadsheets() {
  const { client } = await getGoogleClient();
  const drive = google.drive({ version: "v3", auth: client });
  const result = await callGoogleApi(
    "drive.files.list",
    (signal) =>
      drive.files.list(
        {
          q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
          fields: "files(id,name)",
          pageSize: 50,
          orderBy: "modifiedTime desc",
        },
        { timeout: SHEETS_TIMEOUT_MS, signal },
      ),
  );
  return result.data.files ?? [];
}

export async function listWorksheets(spreadsheetId: string) {
  const { client } = await getGoogleClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const result = await callGoogleApi(
    "spreadsheets.get",
    (signal) => sheets.spreadsheets.get({ spreadsheetId }, { timeout: SHEETS_TIMEOUT_MS, signal }),
    { spreadsheetId },
  );
  const titles =
    result.data.sheets?.map((sheet) => sheet.properties?.title).filter((title): title is string => Boolean(title)) ??
    [];
  if (!result.data.spreadsheetId && !result.data.sheets) {
    throw new GoogleSheetsError(
      "MALFORMED",
      "Google Sheets returned a malformed response while listing worksheets.",
      { spreadsheetId },
    );
  }
  return titles;
}

export async function readWorksheetDetailed(spreadsheetId: string, worksheet: string): Promise<SheetReadSuccess> {
  return coalesceInflight(
    `${spreadsheetId}::${worksheet}`,
    async () => {
      const { client } = await getGoogleClient();
      const sheets = google.sheets({ version: "v4", auth: client });
      const result = await callGoogleApi(
        "spreadsheets.values.get",
        (signal) =>
          sheets.spreadsheets.values.get(
            { spreadsheetId, range: worksheet },
            { timeout: SHEETS_TIMEOUT_MS, signal },
          ),
        { spreadsheetId, worksheet },
      );
      if (result.status && result.status >= 400) {
        throw classifyStatusAsSheetsError(result.status, worksheet, spreadsheetId);
      }
      return parseValuesGetResponse(result.data, worksheet);
    },
    inflightWorksheetReads,
  );
}

export async function readWorksheet(spreadsheetId: string, worksheet: string) {
  const sheet = await readWorksheetDetailed(spreadsheetId, worksheet);
  return sheet.rows;
}

function classifyStatusAsSheetsError(status: number, worksheet: string, spreadsheetId: string) {
  if (status === 401 || status === 403) {
    return new GoogleSheetsError(
      "UNAUTHORIZED",
      "Google Sheets credentials are invalid or expired. Reconnect Google in Settings.",
      { status, worksheet, spreadsheetId },
    );
  }
  if (status === 404) {
    return new GoogleSheetsError("NOT_FOUND", "Google spreadsheet was not found.", {
      status,
      worksheet,
      spreadsheetId,
    });
  }
  return new GoogleSheetsError("UNAVAILABLE", "Google Sheets unavailable/error/timeout.", {
    retryable: status >= 500 || status === 429,
    status,
    worksheet,
    spreadsheetId,
  });
}

export function mapRows(rows: string[][], columnMap: ColumnMap, maxRows?: number): RawLeadInput[] {
  rows = limitWorksheetRows(rows, maxRows);
  const headers = (rows[0] ?? []).map((header) => header.trim());
  const index = new Map(headers.map((header, i) => [header, i]));
  return rows.slice(1).map((row, rowIndex) => {
    const pick = (field: keyof ColumnMap) => {
      const header = columnMap[field];
      if (!header) return null;
      const value = row[index.get(header) ?? -1];
      return value?.trim() || null;
    };
    return {
      name: pick("name"),
      company: pick("company"),
      website: pick("website"),
      email: pick("email"),
      phone: pick("phone"),
      linkedinUrl: pick("linkedinUrl"),
      instagramUrl: pick("instagramUrl"),
      facebookUrl: pick("facebookUrl"),
      twitterUrl: pick("twitterUrl"),
      source: pick("source"),
      location: pick("location"),
      industry: pick("industry"),
      originalPost: pick("originalPost"),
      notes: pick("notes"),
      testRecipient: pick("testRecipient") || row[index.get("Test recipient") ?? index.get("testRecipient") ?? index.get("outreachTestMode") ?? -1] || null,
      externalRowId: String(rowIndex + 2),
    };
  });
}

export async function exportEnrichedRows(input: {
  spreadsheetId: string;
  worksheet: string;
  rows: (string | number | null)[][];
}) {
  const { client } = await getGoogleClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const escaped = input.worksheet.replace(/'/g, "''");
  const result = await callGoogleApi(
    "spreadsheets.values.update",
    (signal) =>
      sheets.spreadsheets.values.update(
        {
          spreadsheetId: input.spreadsheetId,
          range: `'${escaped}'!A1`,
          valueInputOption: "RAW",
          requestBody: { values: input.rows },
        },
        { timeout: SHEETS_TIMEOUT_MS, signal },
      ),
    { spreadsheetId: input.spreadsheetId, worksheet: input.worksheet },
  );
  const updatedRows = Number(result.data?.updatedRows ?? 0);
  if (input.rows.length > 0 && updatedRows < 1) {
    throw new GoogleSheetsError(
      "UNAVAILABLE",
      `Google accepted the ${input.worksheet} write but updated 0 rows.`,
      { spreadsheetId: input.spreadsheetId, worksheet: input.worksheet },
    );
  }
  return { updatedRows, updatedRange: String(result.data?.updatedRange ?? `'${escaped}'`) };
}
