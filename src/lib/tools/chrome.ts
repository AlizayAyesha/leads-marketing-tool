import { randomUUID } from "node:crypto";

import { assertBrowserActionAllowed, BrowserActionBlockedError } from "@/lib/browser/policy";
import { ChromeDisconnectedError, type ChromeDriver } from "@/lib/browser/driver";
import { domainFromUrl, redactSecrets, redactText } from "@/lib/browser/redact";
import type {
  BrowserActionState,
  BrowserCommand,
  BrowserToolResult,
  BrowserTrace,
  ChromeSessionPublic,
} from "@/lib/browser/types";

const traces: BrowserTrace[] = [];
const MAX_TRACES = 80;

let driver: ChromeDriver | null = null;
let session: ChromeSessionPublic = {
  status: "DISCONNECTED",
  profile: "Jarvis Chrome",
  sessionId: null,
  lastUrl: null,
  lastError: null,
  connectedAt: null,
};

export function getChromeSession(): ChromeSessionPublic {
  return { ...session };
}

export function listBrowserTraces() {
  return traces.slice(-MAX_TRACES);
}

export function setChromeDriver(next: ChromeDriver | null) {
  driver = next;
  session = {
    ...session,
    status: next?.connected() ? "CONNECTED" : "DISCONNECTED",
    sessionId: next?.connected() ? session.sessionId : null,
  };
}

export function getChromeDriver() {
  return driver;
}

export function noteChromeNavigation(url: string | null, hint: string | null = null) {
  session = { ...session, lastUrl: url, lastError: hint };
}

export async function connectChrome(nextDriver?: ChromeDriver) {
  if (nextDriver) driver = nextDriver;
  if (!driver) {
    const { PlaywrightChromeDriver } = await import("@/lib/browser/playwright-driver");
    driver = new PlaywrightChromeDriver();
  }
  try {
    const opened = await driver.connect();
    session = {
      status: "CONNECTED",
      profile: opened.profile || "Jarvis Chrome",
      sessionId: opened.sessionId,
      lastUrl: null,
      lastError: null,
      connectedAt: new Date().toISOString(),
    };
    return session;
  } catch (error) {
    session = {
      status: "DISCONNECTED",
      profile: session.profile,
      sessionId: null,
      lastUrl: null,
      lastError: error instanceof Error ? error.message : "Chrome connect failed",
      connectedAt: null,
    };
    throw error;
  }
}

export async function disconnectChrome() {
  await driver?.disconnect();
  session = {
    status: "DISCONNECTED",
    profile: "Jarvis Chrome",
    sessionId: null,
    lastUrl: session.lastUrl,
    lastError: null,
    connectedAt: null,
  };
  return session;
}

export async function performBrowserCommand(command: BrowserCommand): Promise<BrowserToolResult> {
  const started = Date.now();
  const taskId = command.taskId ?? null;
  const runId = command.agentRunId ?? null;

  try {
    assertBrowserActionAllowed({
      action: command.action,
      simulate: command.simulate,
      approvalStatus: command.approvalStatus,
    });
  } catch (error) {
    const blocked = error instanceof BrowserActionBlockedError ? error.message : String(error);
    const state: BrowserActionState = command.simulate ? "BLOCKED" : "BLOCKED";
    const trace = pushTrace({
      task_id: taskId,
      agent_run_id: runId,
      browser_session_id: session.sessionId,
      url: command.url ?? null,
      domain: domainFromUrl(command.url),
      action: command.action,
      timestamp: new Date().toISOString(),
      result: state,
      error: blocked,
      duration_ms: Date.now() - started,
      approval_state: command.approvalStatus ?? (command.simulate ? "SIMULATION" : "UNAPPROVED"),
    });
    return { ok: false, state, action: command.action, evidence: null, error: blocked, trace };
  }

  if (!driver?.connected()) {
    const error = new ChromeDisconnectedError().message;
    const trace = pushTrace({
      task_id: taskId,
      agent_run_id: runId,
      browser_session_id: session.sessionId,
      url: command.url ?? null,
      domain: domainFromUrl(command.url),
      action: command.action,
      timestamp: new Date().toISOString(),
      result: "FAILED",
      error,
      duration_ms: Date.now() - started,
      approval_state: command.approvalStatus ?? null,
    });
    return { ok: false, state: "FAILED", action: command.action, evidence: null, error, trace };
  }

  try {
    const raw = await driver.perform(command);
    const evidence = redactSecrets(raw) as typeof raw;
    if (evidence.textExcerpt) evidence.textExcerpt = redactText(evidence.textExcerpt);
    session.lastUrl = evidence.url;
    session.lastError = null;
    const succeededWithProof =
      command.action === "message_send" || command.action === "proposal_submit" || command.action === "publish"
        ? Boolean(evidence.textExcerpt && /sent|submitted|published|succeeded/i.test(evidence.textExcerpt))
        : true;
    if (!succeededWithProof) {
      throw new Error("Browser action completed without success evidence. Not reporting sent/submitted.");
    }
    const trace = pushTrace({
      task_id: taskId,
      agent_run_id: runId,
      browser_session_id: session.sessionId,
      url: evidence.url,
      domain: domainFromUrl(evidence.url),
      action: command.action,
      timestamp: new Date().toISOString(),
      result: "SUCCEEDED",
      error: null,
      duration_ms: Date.now() - started,
      approval_state: command.approvalStatus ?? "NOT_REQUIRED",
    });
    return { ok: true, state: "SUCCEEDED", action: command.action, evidence, trace };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser action failed";
    session.lastError = message;
    const trace = pushTrace({
      task_id: taskId,
      agent_run_id: runId,
      browser_session_id: session.sessionId,
      url: command.url ?? session.lastUrl,
      domain: domainFromUrl(command.url ?? session.lastUrl),
      action: command.action,
      timestamp: new Date().toISOString(),
      result: "FAILED",
      error: message,
      duration_ms: Date.now() - started,
      approval_state: command.approvalStatus ?? null,
    });
    return { ok: false, state: "FAILED", action: command.action, evidence: null, error: message, trace };
  }
}

function pushTrace(trace: BrowserTrace) {
  traces.push({ ...trace, task_id: trace.task_id ?? randomUUID() });
  if (traces.length > MAX_TRACES) traces.splice(0, traces.length - MAX_TRACES);
  return traces[traces.length - 1];
}

export function resetChromeToolForTests() {
  traces.length = 0;
  driver = null;
  session = {
    status: "DISCONNECTED",
    profile: "Jarvis Chrome",
    sessionId: null,
    lastUrl: null,
    lastError: null,
    connectedAt: null,
  };
}
