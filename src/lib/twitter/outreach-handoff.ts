import "server-only";

import { identifyMissingLinkedIn } from "@/lib/enrichment/identify";
import { enqueue, processQueue } from "@/lib/queue/engine";
import { writeAudit } from "@/lib/db/settings";

/**
 * After X intent discovery: try LinkedIn enrichment, then run the normal pipeline
 * so Decision Maker / strategist / LinkedIn Daily / email can take over.
 * Jarvis still does not auto-DM on X.
 */
export async function handoffTwitterIntentLeads(input: {
  leadIds: string[];
  enrichLinkedIn?: boolean;
  runPipeline?: boolean;
}) {
  const leadIds = [...new Set(input.leadIds.filter(Boolean))];
  const out = {
    leadIds,
    enrich: {
      ok: false as boolean,
      wrote: 0,
      error: null as string | null,
    },
    pipelineQueued: 0,
  };

  if (!leadIds.length) return out;

  if (input.enrichLinkedIn !== false) {
    const enrich = await identifyMissingLinkedIn({ leadIds, limit: Math.min(leadIds.length, 8) });
    out.enrich.ok = enrich.ok;
    out.enrich.error = enrich.ok ? null : enrich.error;
    out.enrich.wrote = enrich.ok ? enrich.results.filter((row) => row.wrote).length : 0;
  }

  if (input.runPipeline !== false) {
    for (const leadId of leadIds) {
      await enqueue({ type: "PIPELINE_LEAD", leadId });
      out.pipelineQueued += 1;
    }
    if (out.pipelineQueued) {
      await processQueue(Math.min(5, out.pipelineQueued));
    }
  }

  await writeAudit({
    action: "discover.twitter_intent.handoff",
    entity: "lead",
    payload: out,
  });

  return out;
}
