import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractSpreadsheetId,
  leadsToSheetRows,
  limitWorksheetRows,
  mergeLeadRowsIntoSheet,
  parseWorkbookConfig,
  rowsToRecords,
  spreadsheetEditUrl,
} from "./workbook";

const FIXTURE_WORKBOOK_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_FIXTURE";

describe("platform workbook", () => {
  it("extracts an id from a Google Sheets URL", () => {
    assert.equal(
      extractSpreadsheetId(
        `https://docs.google.com/spreadsheets/d/${FIXTURE_WORKBOOK_ID}/edit?usp=sharing`,
      ),
      FIXTURE_WORKBOOK_ID,
    );
    assert.equal(extractSpreadsheetId(FIXTURE_WORKBOOK_ID), FIXTURE_WORKBOOK_ID);
    assert.equal(
      spreadsheetEditUrl(FIXTURE_WORKBOOK_ID, 123),
      `https://docs.google.com/spreadsheets/d/${FIXTURE_WORKBOOK_ID}/edit?gid=123#gid=123`,
    );
  });

  it("maps one worksheet per platform and keeps a legacy leads tab", () => {
    const config = parseWorkbookConfig({
      spreadsheetId: FIXTURE_WORKBOOK_ID,
      worksheet: "Sheet1",
    });
    assert.equal(config?.spreadsheetId, FIXTURE_WORKBOOK_ID);
    assert.equal(config?.worksheets.leads, "Sheet1");
    assert.equal(config?.worksheets.upwork, "Upwork");
    assert.equal(config?.worksheets.fiverr, "Fiverr");
    assert.equal(config?.worksheets.linkedin, "LinkedIn");
  });

  it("reads header rows without inventing values", () => {
    const records = rowsToRecords([
      ["title", "budget"],
      ["SaaS dashboard", "$2000"],
      ["", ""],
    ]);
    assert.equal(records[0]?.title, "SaaS dashboard");
    assert.equal(records[1]?.title, "");
  });

  it("caps a five-lead test before rows enter the intake pipeline", () => {
    const rows = [["Name"], ...Array.from({ length: 100 }, (_, index) => [`Lead ${index + 1}`])];
    const limited = limitWorksheetRows(rows, 5);
    assert.equal(limited.length, 6);
    assert.equal(limited[5]?.[0], "Lead 5");
  });

  it("writes stored leads into Leads-tab rows without inventing emails", () => {
    const rows = leadsToSheetRows([
      { company: "Acme", website: "https://acme.example", email: "ops@acme.example" },
      { company: "No Email Co", website: "https://noemail.example" },
    ]);
    assert.equal(rows[0]?.[3], "Email");
    assert.equal(rows[0]?.at(-1), "Sent channel");
    assert.equal(rows[1]?.[1], "Acme");
    assert.equal(rows[1]?.[3], "ops@acme.example");
    assert.equal(rows[2]?.[3], "");
  });

  it("appends new scraped companies and marks already-sent leads on the sheet", () => {
    const merged = mergeLeadRowsIntoSheet(
      [
        ["Name", "Company", "Website", "Email", "Notes"],
        ["", "Old Co", "https://old.example", "ops@old.example", "keep me"],
      ],
      [
        {
          company: "Old Co",
          website: "https://old.example",
          email: "ops@old.example",
          leadId: "L-OLD",
          outreachStatus: "SENT",
          sentAt: "2026-09-10T18:00:00.000Z",
          sentChannel: "EMAIL",
        },
        {
          company: "New Jet",
          website: "https://jet.example",
          email: "ceo@jet.example",
          leadId: "L-NEW",
          outreachStatus: "NOT_SENT",
        },
      ],
    );
    assert.equal(merged.appended, 1);
    assert.equal(merged.sentMarked, 1);
    const headers = merged.rows[0] ?? [];
    const statusCol = headers.indexOf("Outreach status");
    const oldRow = merged.rows[1] ?? [];
    const newRow = merged.rows[2] ?? [];
    assert.equal(oldRow[statusCol], "SENT");
    assert.equal(oldRow[headers.indexOf("Notes")], "keep me");
    assert.equal(newRow[headers.indexOf("Company")], "New Jet");
    assert.equal(newRow[statusCol], "NOT_SENT");
  });

  it("removes cold-emailed companies from the Leads tab on sync", () => {
    const merged = mergeLeadRowsIntoSheet(
      [
        ["Name", "Company", "Website", "Email", "Notes", "Lead ID", "Outreach status"],
        ["", "Old Co", "https://old.example", "ops@old.example", "keep me", "L-OLD", "SENT"],
        ["", "Stay Co", "https://stay.example", "ops@stay.example", "still here", "L-STAY", "NOT_SENT"],
      ],
      [
        {
          company: "Stay Co",
          website: "https://stay.example",
          email: "ops@stay.example",
          leadId: "L-STAY",
          outreachStatus: "NOT_SENT",
        },
      ],
      {
        remove: [{ leadId: "L-OLD", email: "ops@old.example", website: "https://old.example" }],
      },
    );
    assert.equal(merged.removed, 1);
    assert.equal(merged.total, 1);
    assert.equal(merged.rows.length, 2);
    assert.equal(merged.rows[1]?.[1], "Stay Co");
    assert.ok(!merged.rows.some((row) => row.includes("Old Co")));
  });

  it("moves used leads onto Used already and keeps Leads unused-only", () => {
    const leadsTab = mergeLeadRowsIntoSheet(
      [
        ["Name", "Company", "Website", "Email", "Lead ID", "Outreach status"],
        ["A", "Used Co", "https://used.example", "a@used.example", "L-USED", "NOT_SENT"],
        ["B", "Fresh Co", "https://fresh.example", "b@fresh.example", "L-FRESH", "NOT_SENT"],
      ],
      [
        {
          name: "B",
          company: "Fresh Co",
          website: "https://fresh.example",
          email: "b@fresh.example",
          leadId: "L-FRESH",
          outreachStatus: "NOT_SENT",
        },
      ],
      {
        remove: [{ leadId: "L-USED", email: "a@used.example", website: "https://used.example" }],
      },
    );
    assert.equal(leadsTab.removed, 1);
    assert.equal(leadsTab.total, 1);
    assert.equal(leadsTab.rows[1]?.[1], "Fresh Co");
    assert.ok(!leadsTab.rows.some((row) => row.includes("Used Co")));

    const usedTab = mergeLeadRowsIntoSheet(
      [["Name", "Company", "Website", "Email", "Lead ID", "Outreach status", "Sent at", "Sent channel"]],
      [
        {
          name: "A",
          company: "Used Co",
          website: "https://used.example",
          email: "a@used.example",
          leadId: "L-USED",
          outreachStatus: "SENT",
          sentAt: "2026-09-19T00:00:00.000Z",
          sentChannel: "EMAIL",
        },
      ],
    );
    assert.equal(usedTab.appended, 1);
    assert.equal(usedTab.rows[1]?.[1], "Used Co");
    assert.equal(usedTab.rows[1]?.[5], "SENT");
    assert.equal(usedTab.rows[1]?.[7], "EMAIL");

    const usedAgain = mergeLeadRowsIntoSheet(usedTab.rows, [
      {
        name: "A",
        company: "Used Co",
        website: "https://used.example",
        email: "a@used.example",
        leadId: "L-USED",
        outreachStatus: "SENT",
        sentAt: "2026-09-19T01:00:00.000Z",
        sentChannel: "EMAIL",
      },
    ]);
    assert.equal(usedAgain.appended, 0);
    assert.equal(usedAgain.updated, 1);
    assert.equal(usedAgain.total, 1);
  });

  it("exposes Used already worksheet name for sheet sync", async () => {
    const { USED_ALREADY_WORKSHEET } = await import("./workbook");
    assert.equal(USED_ALREADY_WORKSHEET, "Used already");
  });
});
