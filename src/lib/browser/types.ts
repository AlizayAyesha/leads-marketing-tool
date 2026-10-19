export type BrowserAction =
  | "navigate"
  | "back"
  | "forward"
  | "reload"
  | "open_tab"
  | "close_tab"
  | "switch_tab"
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "hover"
  | "keyboard"
  | "read"
  | "extract_table"
  | "extract_links"
  | "extract_forms"
  | "screenshot"
  | "download"
  | "upload"
  | "form_fill"
  | "form_submit"
  | "message_prepare"
  | "message_send"
  | "proposal_submit"
  | "publish"
  | "purchase"
  | "delete"
  | "security_change"
  | "sheet_read"
  | "sheet_write_enrichment"
  | "sheet_write_original";

export const EXTERNAL_BUSINESS_ACTIONS = new Set<BrowserAction>([
  "message_send",
  "proposal_submit",
  "publish",
  "purchase",
  "delete",
  "security_change",
  "form_submit",
  "sheet_write_original",
]);

export function isExternalBusinessAction(action: BrowserAction) {
  return EXTERNAL_BUSINESS_ACTIONS.has(action);
}

export function isBrowserAccessAllowed(action: BrowserAction) {
  return !isExternalBusinessAction(action);
}

export type BrowserActionState =
  | "PREPARED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED";

export type BrowserCommand = {
  action: BrowserAction;
  url?: string | null;
  selector?: string | null;
  text?: string | null;
  value?: string | null;
  spreadsheetId?: string | null;
  worksheet?: string | null;
  simulate?: boolean;
  approvalStatus?: string | null;
  taskId?: string | null;
  agentRunId?: string | null;
  leadId?: string | null;
};

export type BrowserEvidence = {
  url: string | null;
  title: string | null;
  textExcerpt?: string | null;
  tables?: string[][];
  links?: { href: string; text: string }[];
  screenshotNote?: string | null;
};

export type BrowserTrace = {
  task_id: string | null;
  agent_run_id: string | null;
  browser_session_id: string | null;
  url: string | null;
  domain: string | null;
  action: BrowserAction;
  timestamp: string;
  result: BrowserActionState;
  error: string | null;
  duration_ms: number;
  approval_state: string | null;
};

export type BrowserToolResult = {
  ok: boolean;
  state: BrowserActionState;
  action: BrowserAction;
  evidence: BrowserEvidence | null;
  error?: string;
  trace: BrowserTrace;
};

export type ChromeSessionPublic = {
  status: "CONNECTED" | "DISCONNECTED";
  profile: string;
  sessionId: string | null;
  lastUrl: string | null;
  lastError: string | null;
  connectedAt: string | null;
};
