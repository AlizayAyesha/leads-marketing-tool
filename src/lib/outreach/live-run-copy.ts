export function summarizeLiveRun(report: {
  needNewScrape?: boolean;
  import: { message?: string };
  engine: { drafts: number; sent: number; passed: number };
  linkedinPreview?: { connectionCandidates?: number; messageCandidates?: number };
  linkedinDaily: { error?: string; connectionsSent?: number; messagesSent?: number; skippedSend?: boolean };
  blockedSummary: string[];
}): string[] {
  if (report.needNewScrape) {
    return [
      report.import.message ||
        "Old scraped data is done. Need new scraped data?",
      "Put a new scrape on the Leads tab, or click Need new scraped data.",
      "Use this sheet anyway only if you still want to work the same people.",
    ];
  }
  const readyConn = report.linkedinPreview?.connectionCandidates ?? 0;
  const readyMsg = report.linkedinPreview?.messageCandidates ?? 0;
  const lines = [
    "Prepare done: sheet import + research + drafts. LinkedIn / X were not sent.",
    `Import: ${report.import.message}`,
    `Email engine: ${report.engine.drafts} drafts · ${report.engine.sent} sent · ${report.engine.passed} PASS.`,
    `LinkedIn ready: ${readyConn} connection(s) · ${readyMsg} message(s). Send from Home channel buttons.`,
  ];
  if (report.linkedinDaily.error) lines.push(report.linkedinDaily.error);
  if (report.blockedSummary[0]) lines.push(`Note: ${report.blockedSummary[0]}`);
  return lines;
}
