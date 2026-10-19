import "server-only";

import { google } from "googleapis";

import { getGoogleClient } from "@/lib/data-sources/google";
import { PLATFORM_SHEETS, SHEET_HEADERS, type PlatformSheetKey } from "@/lib/google/workbook";
import { GoogleSheetsError, SHEETS_TIMEOUT_MS, callGoogleApi, parseValuesGetResponse } from "@/lib/google/sheets-client";

export async function provisionPlatformWorkbook(spreadsheetId: string) {
  const { client } = await getGoogleClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const book = await callGoogleApi(
    "spreadsheets.get",
    (signal) => sheets.spreadsheets.get({ spreadsheetId }, { timeout: SHEETS_TIMEOUT_MS, signal }),
    { spreadsheetId },
  );
  const existing = new Set(
    (book.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)),
  );

  const addRequests = PLATFORM_SHEETS.filter((sheet) => !existing.has(sheet.title)).map((sheet) => ({
    addSheet: { properties: { title: sheet.title } },
  }));

  if (addRequests.length) {
    await callGoogleApi(
      "spreadsheets.batchUpdate",
      (signal) =>
        sheets.spreadsheets.batchUpdate(
          {
            spreadsheetId,
            requestBody: { requests: addRequests },
          },
          { timeout: SHEETS_TIMEOUT_MS, signal },
        ),
      { spreadsheetId },
    );
  }

  const created: string[] = [];
  const headed: string[] = [];
  for (const sheet of PLATFORM_SHEETS) {
    const title = sheet.title;
    if (!existing.has(title)) created.push(title);
    const current = await callGoogleApi(
      "spreadsheets.values.get",
      (signal) =>
        sheets.spreadsheets.values.get({ spreadsheetId, range: title }, { timeout: SHEETS_TIMEOUT_MS, signal }),
      { spreadsheetId, worksheet: title },
    );
    const parsed = parseValuesGetResponse(current.data, title);
    if (parsed.rows.length === 0) {
      await callGoogleApi(
        "spreadsheets.values.update",
        (signal) =>
          sheets.spreadsheets.values.update(
            {
              spreadsheetId,
              range: `${title}!A1`,
              valueInputOption: "RAW",
              requestBody: { values: [SHEET_HEADERS[sheet.key as PlatformSheetKey]] },
            },
            { timeout: SHEETS_TIMEOUT_MS, signal },
          ),
        { spreadsheetId, worksheet: title },
      );
      headed.push(title);
    }
  }

  return {
    spreadsheetId,
    created,
    headed,
    existing: [...existing],
  };
}

export async function ensureWorksheet(spreadsheetId: string, title: string, options: { bringToFront?: boolean } = {}) {
  const { client } = await getGoogleClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const book = await callGoogleApi(
    "spreadsheets.get",
    (signal) => sheets.spreadsheets.get({ spreadsheetId }, { timeout: SHEETS_TIMEOUT_MS, signal }),
    { spreadsheetId, worksheet: title },
  );
  const match = (book.data.sheets ?? []).find((sheet) => sheet.properties?.title === title);
  let sheetId = match?.properties?.sheetId;
  const requests: Array<Record<string, unknown>> = [];
  if (typeof sheetId === "number" && match?.properties?.hidden) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, hidden: false },
        fields: "hidden",
      },
    });
  }
  if (typeof sheetId === "number" && options.bringToFront && (match?.properties?.index ?? 0) !== 0) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, index: 0 },
        fields: "index",
      },
    });
  }
  if (requests.length) {
    await callGoogleApi(
      "spreadsheets.batchUpdate",
      (signal) =>
        sheets.spreadsheets.batchUpdate(
          {
            spreadsheetId,
            requestBody: { requests },
          },
          { timeout: SHEETS_TIMEOUT_MS, signal },
        ),
      { spreadsheetId, worksheet: title },
    );
  }
  if (typeof sheetId !== "number") {
    const created = await callGoogleApi(
      "spreadsheets.batchUpdate",
      (signal) =>
        sheets.spreadsheets.batchUpdate(
          {
            spreadsheetId,
            requestBody: {
              requests: [{ addSheet: { properties: { title, index: options.bringToFront ? 0 : undefined } } }],
            },
          },
          { timeout: SHEETS_TIMEOUT_MS, signal },
        ),
      { spreadsheetId, worksheet: title },
    );
    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  if (typeof sheetId !== "number") {
    throw new GoogleSheetsError("UNAVAILABLE", `Could not open or create the "${title}" tab.`, {
      spreadsheetId,
      worksheet: title,
    });
  }
  return { sheetId, title };
}

