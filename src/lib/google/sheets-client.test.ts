import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GoogleSheetsError,
  callGoogleApi,
  classifyGoogleSheetsError,
  coalesceInflight,
  connectionHasSheetsScope,
  emptyLeadsTabMessage,
  parseValuesGetResponse,
  redactGoogleErrorText,
  sheetFailureToAvailability,
  sheetReadAllowsPipeline,
  timeoutLeadsTabMessage,
} from "./sheets-client";

function gaxiosError(status: number, message: string) {
  return Object.assign(new Error(message), {
    status,
    response: { status, data: { error: { code: status, message } } },
  });
}

describe("Google Sheets read contract", () => {
  it("1. successful Leads read is not empty and may continue", () => {
    const parsed = parseValuesGetResponse(
      {
        range: "Leads!A1:N53",
        majorDimension: "ROWS",
        values: [
          ["Name", "Company", "Email"],
          ["Ada", "Northline", "ada@northline.example"],
          ["Lin", "Harbor", "lin@harbor.example"],
        ],
      },
      "Leads",
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.empty, false);
    assert.equal(parsed.dataRowCount, 2);
    assert.equal(parsed.rows[1]?.[0], "Ada");
    assert.equal(sheetReadAllowsPipeline(parsed), true);
    assert.match(parsed.message, /contains 2 rows/);
  });

  it("2. empty Leads tab is a valid 0-row read, not an API failure", () => {
    const parsed = parseValuesGetResponse(
      { range: "Leads", majorDimension: "ROWS" },
      "Leads",
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.empty, true);
    assert.equal(parsed.dataRowCount, 0);
    assert.deepEqual(parsed.rows, []);
    assert.equal(parsed.message, emptyLeadsTabMessage("Leads"));
    assert.equal(sheetReadAllowsPipeline(parsed), true);
  });

  it("2b. header-only Leads tab is still 0 data rows", () => {
    const parsed = parseValuesGetResponse(
      {
        range: "Leads",
        majorDimension: "ROWS",
        values: [["Name", "Company", "Notes"]],
      },
      "Leads",
    );
    assert.equal(parsed.empty, true);
    assert.equal(parsed.dataRowCount, 0);
    assert.equal(parsed.message, "Leads tab exists and contains 0 rows.");
  });

  it("3. Google API timeout is not an empty Leads sheet", async () => {
    const started = Date.now();
    await assert.rejects(
      () =>
        callGoogleApi(
          "spreadsheets.values.get",
          () => new Promise(() => undefined),
          { timeoutMs: 25, retries: 2, worksheet: "Leads" },
        ),
      (error: unknown) => {
        assert.ok(error instanceof GoogleSheetsError);
        assert.equal(error.code, "TIMEOUT");
        assert.equal(error.message, timeoutLeadsTabMessage("Leads"));
        assert.notEqual(error.message, emptyLeadsTabMessage("Leads"));
        const failure = sheetFailureToAvailability(error);
        assert.equal(failure.ok, false);
        assert.equal(failure.empty, false);
        assert.equal(failure.dataRowCount, null);
        assert.equal(sheetReadAllowsPipeline(failure), false);
        return true;
      },
    );
    assert.ok(Date.now() - started < 400, "timeout must fail fast and not retry");
  });

  it("4. Google API 401 / invalid credentials is not 0 rows", () => {
    const error = classifyGoogleSheetsError(gaxiosError(401, "Invalid Credentials"), {
      worksheet: "Leads",
    });
    assert.equal(error.code, "UNAUTHORIZED");
    assert.match(error.message, /invalid or expired/i);
    const failure = sheetFailureToAvailability(error);
    assert.equal(failure.empty, false);
    assert.equal(sheetReadAllowsPipeline(failure), false);
  });

  it("4b. OAuth invalid_grant is reconnect, not a generic timeout", () => {
    const error = classifyGoogleSheetsError(
      Object.assign(new Error("Request failed with status code 400"), {
        status: 400,
        response: {
          status: 400,
          data: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        },
      }),
      { worksheet: "Leads" },
    );
    assert.equal(error.code, "UNAUTHORIZED");
    assert.match(error.message, /Reconnect Google/i);
  });

  it("5. missing spreadsheet is not an empty Leads tab", () => {
    const error = classifyGoogleSheetsError(gaxiosError(404, "Requested entity was not found."), {
      worksheet: "Leads",
      spreadsheetId: "missing",
    });
    assert.equal(error.code, "NOT_FOUND");
    assert.equal(error.message, "Google spreadsheet was not found.");
    assert.equal(sheetReadAllowsPipeline(sheetFailureToAvailability(error)), false);
  });

  it("6. missing Leads tab is not an empty Leads tab", () => {
    const error = classifyGoogleSheetsError(gaxiosError(400, "Unable to parse range: Leads"), {
      worksheet: "Leads",
    });
    assert.equal(error.code, "MISSING_TAB");
    assert.equal(error.message, 'Google Sheets tab "Leads" was not found.');
    assert.equal(sheetReadAllowsPipeline(sheetFailureToAvailability(error)), false);
  });

  it("7. malformed API response is not 0 rows", () => {
    assert.throws(
      () => parseValuesGetResponse({ values: "not-rows" }, "Leads"),
      (error: unknown) => {
        assert.ok(error instanceof GoogleSheetsError);
        assert.equal(error.code, "MALFORMED");
        assert.match(error.message, /malformed response while reading the Leads tab/);
        assert.equal(sheetReadAllowsPipeline(sheetFailureToAvailability(error)), false);
        return true;
      },
    );
    assert.throws(() => parseValuesGetResponse(null, "Leads"), GoogleSheetsError);
    assert.throws(() => parseValuesGetResponse({}, "Leads"), GoogleSheetsError);
  });

  it("Google Sheets timeout ≠ empty Leads sheet", () => {
    const timeout = sheetFailureToAvailability(
      new GoogleSheetsError("TIMEOUT", timeoutLeadsTabMessage("Leads")),
    );
    const empty = parseValuesGetResponse({ range: "Leads", majorDimension: "ROWS" }, "Leads");
    assert.equal(empty.message, "Leads tab exists and contains 0 rows.");
    assert.equal(timeout.message, "Google Sheets request timed out while reading the Leads tab.");
    assert.notEqual(timeout.message, empty.message);
    assert.equal(empty.ok, true);
    assert.equal(timeout.ok, false);
    assert.equal(timeout.empty, false);
  });

  it("Google Sheets failure ≠ permission to run the outreach pipeline", () => {
    const timeout = sheetFailureToAvailability(
      new GoogleSheetsError("TIMEOUT", timeoutLeadsTabMessage("Leads")),
    );
    const unauthorized = sheetFailureToAvailability(
      classifyGoogleSheetsError(gaxiosError(401, "Invalid Credentials"), { worksheet: "Leads" }),
    );
    const empty = parseValuesGetResponse({ range: "Leads", majorDimension: "ROWS" }, "Leads");
    assert.equal(sheetReadAllowsPipeline(timeout), false);
    assert.equal(sheetReadAllowsPipeline(unauthorized), false);
    assert.equal(sheetReadAllowsPipeline(empty), true);
  });
});

describe("Google Sheets transport safeguards", () => {
  it("retries a transient 503 once with backoff, then succeeds", async () => {
    let attempts = 0;
    const result = await callGoogleApi(
      "spreadsheets.values.get",
      async () => {
        attempts += 1;
        if (attempts === 1) throw gaxiosError(503, "backendError");
        return { ok: true };
      },
      { retries: 1, retryBaseMs: 5, timeoutMs: 200, worksheet: "Leads" },
    );
    assert.equal(attempts, 2);
    assert.deepEqual(result, { ok: true });
  });

  it("does not retry 401 invalid credentials", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        callGoogleApi(
          "spreadsheets.values.get",
          async () => {
            attempts += 1;
            throw gaxiosError(401, "Invalid Credentials");
          },
          { retries: 3, retryBaseMs: 5, worksheet: "Leads" },
        ),
      (error: unknown) => error instanceof GoogleSheetsError && error.code === "UNAUTHORIZED",
    );
    assert.equal(attempts, 1);
  });

  it("coalesces duplicate concurrent Sheet reads", async () => {
    const store = new Map<string, Promise<string>>();
    let starts = 0;
    const [a, b] = await Promise.all([
      coalesceInflight(
        "sheet",
        async () => {
          starts += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return "one";
        },
        store,
      ),
      coalesceInflight(
        "sheet",
        async () => {
          starts += 1;
          return "two";
        },
        store,
      ),
    ]);
    assert.equal(a, "one");
    assert.equal(b, "one");
    assert.equal(starts, 1);
  });

  it("treats a hung empty-reason network failure as unavailable, not empty", () => {
    const error = classifyGoogleSheetsError(
      new Error(
        "request to https://sheets.googleapis.com/v4/spreadsheets/abc/values/Leads failed, reason: ",
      ),
      { worksheet: "Leads" },
    );
    assert.equal(error.code, "UNAVAILABLE");
    assert.equal(error.message, "Google Sheets unavailable/error/timeout.");
    assert.equal(error.retryable, true);
    assert.equal(sheetReadAllowsPipeline(sheetFailureToAvailability(error)), false);
  });

  it("requires Sheets scope when scopes are present", () => {
    assert.equal(connectionHasSheetsScope(["https://www.googleapis.com/auth/spreadsheets"]), true);
    assert.equal(connectionHasSheetsScope(["https://www.googleapis.com/auth/gmail.send"]), false);
    assert.equal(connectionHasSheetsScope([]), true);
  });

  it("never logs raw OAuth tokens", () => {
    const redacted = redactGoogleErrorText(
      "Authorization: Bearer ya29.secret-token access_token=ya29.abc refresh_token=1//xyz",
    );
    assert.equal(redacted.includes("ya29.secret-token"), false);
    assert.equal(redacted.includes("1//xyz"), false);
    assert.match(redacted, /\[redacted/);
  });
});
