import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_CONTRACTS, contractFor } from "../agents/contracts";
import { browserIntentFromCommand } from "./intent";
import { MockChromeDriver } from "./mock-driver";
import { assertBrowserActionAllowed, BrowserActionBlockedError } from "./policy";
import { redactSecrets, redactText } from "./redact";
import { tableToLeadInputs, SHEET_ENRICHMENT_COLUMNS } from "./sheets";
import { defaultChromeTarget, maskEmail, parseChromeInfoCache, chromeUserDataDir } from "./profiles";
import { chromeProfileDir } from "./playwright-driver";
import { mapConcurrent } from "../queue/concurrent";
import { normalizeLead } from "../leads/normalize";
import {
  connectChrome,
  disconnectChrome,
  getChromeSession,
  listBrowserTraces,
  performBrowserCommand,
  resetChromeToolForTests,
} from "../tools/chrome";

describe("browser capability registration", () => {
  it("registers Chrome as a tool of the Browser Agent, not a second brain", () => {
    const browser = contractFor("browser");
    assert.ok(browser);
    assert.deepEqual(browser.allowedTools, ["chrome"]);
    assert.ok(browser.can.some((item) => item.includes("navigate")));
    assert.ok(browser.cannot.some((item) => item.includes("qualification")));
    assert.equal(
      AGENT_CONTRACTS.some((item) => item.slug === "browser_brain" || item.slug === "chrome_brain"),
      false,
    );
  });
});

describe("task → browser tool routing", () => {
  it("maps operator commands through the existing Brain intents", () => {
    assert.equal(browserIntentFromCommand("Open my Google Sheet.")?.intent, "BROWSER_NAVIGATE");
    assert.equal(browserIntentFromCommand("Open my Google Sheet.")?.url, "sheet");
    assert.equal(browserIntentFromCommand("Update the research columns.")?.intent, "EXPORT_SHEET");
    assert.equal(browserIntentFromCommand("Open the drafts.")?.intent, "SHOW_QUEUE");
    assert.equal(browserIntentFromCommand("Research all new leads."), null);
  });
});

describe("Google Sheets ingestion mapping", () => {
  it("turns sheet tables into leads that still normalize into Postgres-shaped records", () => {
    const leads = tableToLeadInputs([
      ["Company", "Website", "Email"],
      ["Northwind Ops Fixture", "https://fixture.example.test/northwind-ops", "priya@northwind-ops.fixture"],
    ]);
    assert.equal(leads[0]?.sourceActor, "chrome");
    const normalized = normalizeLead(leads[0]!);
    assert.equal(normalized.company, "Northwind Ops Fixture");
    assert.equal(normalized.email, "priya@northwind-ops.fixture");
    assert.ok(SHEET_ENRICHMENT_COLUMNS.includes("Qualification"));
  });
});

describe("browser failure isolation", () => {
  it("one browser failure does not kill unrelated tasks", async () => {
    const settled = await mapConcurrent(["a", "fail", "c"], 2, async (item) => {
      if (item === "fail") throw new Error("browser error");
      return item;
    });
    assert.equal(settled[0]?.status, "fulfilled");
    assert.equal(settled[1]?.status, "rejected");
    assert.equal(settled[2]?.status, "fulfilled");
  });
});

describe("simulation and approval", () => {
  it("blocks simulated external communication", () => {
    assert.throws(
      () => assertBrowserActionAllowed({ action: "message_send", simulate: true }),
      BrowserActionBlockedError,
    );
    assert.throws(
      () => assertBrowserActionAllowed({ action: "message_send", simulate: true }),
      /ACTION_BLOCKED_SIMULATION/,
    );
  });

  it("blocks unapproved external actions and allows approved send only after the gate", async () => {
    resetChromeToolForTests();
    const driver = new MockChromeDriver();
    await connectChrome(driver);
    const blocked = await performBrowserCommand({
      action: "message_send",
      url: "https://mail.example",
      approvalStatus: "PENDING_APPROVAL",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.state, "BLOCKED");
    assert.match(blocked.error ?? "", /EXTERNAL_ACTION_BLOCKED/);

    const approved = await performBrowserCommand({
      action: "message_send",
      url: "https://mail.example",
      approvalStatus: "APPROVED",
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.state, "SUCCEEDED");
    assert.match(approved.evidence?.textExcerpt ?? "", /sent/i);
    await disconnectChrome();
  });
});

describe("successful and failed browser evidence", () => {
  it("records success evidence and accurate failures", async () => {
    resetChromeToolForTests();
    const driver = new MockChromeDriver();
    await connectChrome(driver);
    const ok = await performBrowserCommand({
      action: "navigate",
      url: "https://fixture.example.test/northwind-ops",
      taskId: "task-1",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.evidence?.url, "https://fixture.example.test/northwind-ops");
    assert.equal(ok.trace.result, "SUCCEEDED");
    assert.equal(ok.trace.task_id, "task-1");

    driver.failNext = "website timeout";
    const failed = await performBrowserCommand({
      action: "read",
      url: "https://fixture.example.test/timeout",
      taskId: "task-2",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.state, "FAILED");
    assert.equal(failed.error, "website timeout");
    assert.ok(listBrowserTraces().some((item) => item.task_id === "task-2" && item.result === "FAILED"));
    await disconnectChrome();
  });

  it("does not claim Chrome is connected before connect succeeds", () => {
    resetChromeToolForTests();
    assert.equal(getChromeSession().status, "DISCONNECTED");
  });
});

describe("secret redaction", () => {
  it("never returns cookies, passwords, or tokens to the model", () => {
    const redacted = redactSecrets({
      cookie: "sid=abc",
      password: "secret",
      Authorization: "Bearer supersecrettokenvalue",
      title: "Public page",
    }) as Record<string, string>;
    assert.equal(redacted.cookie, "[REDACTED]");
    assert.equal(redacted.password, "[REDACTED]");
    assert.equal(redacted.Authorization, "[REDACTED]");
    assert.equal(redacted.title, "Public page");
    assert.match(redactText("Authorization: Bearer aaa.bbb.ccc"), /REDACTED/);
  });
});

describe("Chrome profile selection", () => {
  it("masks emails and lists the operator without attaching to everyday Chrome", () => {
    assert.equal(maskEmail("jane.doe@example.com"), "j••••@example.com");
    const parsed = parseChromeInfoCache({
      Default: { gaia_name: "Jane Doe", user_name: "jane.doe@example.com", name: "Jane" },
      "Profile 1": { gaia_name: "Other", user_name: "other@example.com", name: "Other" },
    });
    assert.equal(parsed[0]?.directory, "Default");
    assert.equal(parsed[0]?.emailHint, "j••••@example.com");
    const target = defaultChromeTarget([
      ...parsed,
      { id: "jarvis", mode: "jarvis", directory: null, displayName: "Blank Jarvis Chrome", emailHint: null },
    ]);
    assert.equal(target.mode, "jarvis");
    assert.equal(target.profileDirectory, null);
    assert.notEqual(chromeProfileDir(), chromeUserDataDir());
    assert.match(chromeProfileDir(), /\.jarvis/);
  });
});
