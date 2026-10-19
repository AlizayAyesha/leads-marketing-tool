export type DiscoverCounters = {
  new: number;
  duplicates: number;
  failed: number;
  skipped: number;
  skippedPortals?: number;
};

export type ClassifyReportCounters = {
  classified: number;
  newThisRunEvaluated: number;
  existingUnclassifiedEvaluated: number;
  priority: number;
  nurture: number;
  rejected: number;
};

export function formatDiscoverSummary(input: {
  discovery: DiscoverCounters;
  classification: ClassifyReportCounters;
}) {
  const { discovery, classification } = input;
  const portalSkip = discovery.skippedPortals ?? 0;
  const skipBits = [
    `${discovery.skipped} skipped known URL${discovery.skipped === 1 ? "" : "s"}`,
    portalSkip ? `${portalSkip} skipped listing portal${portalSkip === 1 ? "" : "s"}` : null,
    discovery.failed ? `${discovery.failed} failed` : null,
  ].filter(Boolean);
  const discoveryLine = `Discovery: ${discovery.new} new · ${discovery.duplicates} duplicate${discovery.duplicates === 1 ? "" : "s"} · ${skipBits.join(" · ")}.`;
  const classificationLine =
    classification.classified === 0
      ? "Classification: 0 candidates evaluated."
      : [
          classification.newThisRunEvaluated
            ? `${classification.newThisRunEvaluated} new this run`
            : null,
          classification.existingUnclassifiedEvaluated
            ? `${classification.existingUnclassifiedEvaluated} existing unclassified`
            : null,
        ]
          .filter(Boolean)
          .join(" + ") +
        ` → ${classification.priority} PRIORITY · ${classification.nurture} NURTURE · ${classification.rejected} REJECT.`;

  return `${discoveryLine} ${classificationLine}`;
}

export function formatDiscoverDoneBanner(input: {
  discovery: DiscoverCounters;
  classification: ClassifyReportCounters;
}) {
  const { discovery, classification } = input;
  if (discovery.new === 0 && classification.classified === 0) {
    return `Done — 0 new · 0 classified · 0 PRIORITY`;
  }
  return `Done — ${discovery.new} new · ${classification.existingUnclassifiedEvaluated} existing classified · ${classification.priority} PRIORITY · ${classification.nurture} NURTURE · ${classification.rejected} REJECT`;
}

/** Discover is done when Postgres classified. Sheets export is optional. */
export function formatDiscoverOperatorMessage(input: {
  summary: string;
  sheetOk: boolean;
  sheetMessage: string;
  quota: boolean;
  discoveryNew: number;
}) {
  const sheetsNote = input.sheetOk
    ? input.sheetMessage
    : `${input.sheetMessage} Leads stay in Postgres. Reconnect Google in Settings to export — do not Discover again just to retry the sheet.`;
  const quotaNote = input.quota
    ? input.discoveryNew === 0
      ? "Apify monthly limit hit. Fallback search may still run, but Maps coverage is unavailable until quota resets."
      : "Apify monthly limit blocked Maps; connected scrapers still ran."
    : null;
  return [input.summary, sheetsNote, quotaNote, "PRIORITY is the work. Classification does not send outreach."]
    .filter(Boolean)
    .join(" ");
}
