import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

/**
 * Jarvis Brain — conversation intelligence above the existing workforce.
 * The LLM may reason, pick existing capabilities, explain, and keep context.
 * It may not invent evidence, bypass policy, send externally, or rewrite business rules.
 * interpretCommand() is an internal execution adapter, not Jarvis's conversational interface.
 */

import { getAIProvider } from "@/lib/ai";
import { generateJson } from "@/lib/ai/provider";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { buildJarvisDoctrine } from "@/lib/jarvis/doctrine";
import { buildExecutionSnapshot } from "@/lib/jarvis/execution-brief";
import { JARVIS_INTERPRET_IS_ADAPTER, JARVIS_LLM_INVARIANT } from "@/lib/jarvis/invariant";
import { heuristicBrainPlan, parseBrainPlan, proseFromToolFacts, type BrainPlan } from "@/lib/jarvis/brain-plan";
import {
  appendJarvisMessage,
  getOrCreateJarvisThread,
  listJarvisMessages,
  updateJarvisThreadContext,
} from "@/lib/jarvis/threads";
import { runJarvisTool } from "@/lib/jarvis/tools";
import { JARVIS_TOOL_NAMES } from "@/lib/jarvis/tools-catalog";

export type JarvisTurnResult = {
  threadId: string;
  heard: string;
  spoken: string;
  intent: string;
  summary: string;
  lastLeadId: string | null;
  lastDraftId: string | null;
  lastCompany: string | null;
};

const SYSTEM = `You are Jarvis, ${getBusinessProfile().businessName}' operator-facing brain. You sit in front of an existing workforce of agents. You are not a command dispatcher and not a dashboard reader.

${JARVIS_LLM_INVARIANT}
${JARVIS_INTERPRET_IS_ADAPTER}

Follow the Knowledge Constitution in the operator payload. Priority of truth: LIVE POSTGRES FACTS beat doctrine beat conversation history beat general world knowledge. Never invent scores, sends, meetings, or evidence.

When answering “what should I do today” (or similar), reason as an operator: Objective → Current reality → Bottleneck → Options → Expected value → Risk → Recommendation → Action. Prefer one sharp recommendation over a metric dump.

In the reply, make the epistemic type obvious when it changes the decision (FACT / INFERENCE / UNKNOWN / RECOMMENDATION). If you lack a named commercial ≥80 Send-Ready lead, say UNKNOWN rather than inventing one.

Personality: calm, direct, commercially sharp. Disagree when the data disagrees. Do not flatter.

Reply in spoken prose. Do not dump imported/valid/researched counters unless the operator asked for metrics.

Tools: ${JARVIS_TOOL_NAMES.join(", ")}.
- get_execution_brief / get_analytics: live state.
- list_opportunities: PRIORITY opportunities only (WHO / WHY NOW / OFFER / CONFIDENCE / NEXT). NURTURE and REJECT are not the queue.
- get_lead / get_draft / list_pending_drafts: inspect. Include stored Opportunity.selection.
- execute_intent: wrap interpretCommand for research/qualify/draft work. It cannot send.
- request_send: the ONLY send request. It calls the existing sendApprovedDraft gates. If commercial score is 74 it must fail. You cannot round it to 80.
- run_scraper/get_scraper_job/cancel_scraper_job/search_scraped_data/get_scraped_evidence acquire and inspect permitted public evidence only. Scraping never sends outreach and never turns extracted claims into verified facts by itself.

Return JSON:
{ "reply": "operator-facing prose", "tools": [{"name":"...","args":{}}], "lastLeadId": "ZJ-… or null", "lastDraftId": "uuid or null", "lastCompany": "string or null" }
If you still need tools, set reply to a short status and fill tools. After tool results, return tools: [] and a full reply.`;

export async function jarvisBrainTurn(input: { message: string; threadId?: string | null }): Promise<JarvisTurnResult> {
  const heard = input.message.trim();
  const thread = await getOrCreateJarvisThread(input.threadId);
  if (!heard) {
    return {
      threadId: thread.id,
      heard: "",
      spoken: "I did not catch that.",
      intent: "UNKNOWN",
      summary: "I did not catch that.",
      lastLeadId: thread.lastLeadId,
      lastDraftId: thread.lastDraftId,
      lastCompany: thread.lastCompany,
    };
  }

  await appendJarvisMessage({ threadId: thread.id, role: "USER", content: heard });
  const [history, snapshot] = await Promise.all([
    listJarvisMessages(thread.id, 30),
    buildExecutionSnapshot(),
  ]);
  const doctrine = buildJarvisDoctrine();
  const ctx: {
    lastLeadId: string | null;
    lastDraftId: string | null;
    lastCompany: string | null;
    lastLeadRecordId: string | null;
  } = {
    lastLeadId: thread.lastLeadId,
    lastDraftId: thread.lastDraftId,
    lastCompany: thread.lastCompany,
    lastLeadRecordId: thread.lastLeadRecordId,
  };

  const historyText = history
    .slice(-16)
    .map((row) => `${row.role}${row.toolName ? `(${row.toolName})` : ""}: ${row.content.slice(0, 500)}`)
    .join("\n");

  await refreshCredentialCache();
  const provider = getAIProvider();
  let plan: BrainPlan;
  if (provider.configured) {
    try {
      const { data } = await generateJson<unknown>(
        provider,
        [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `KNOWLEDGE + DOCTRINE:\n${doctrine}\n\nLIVE POSTGRES:\n${snapshot.text}\n\nTHREAD POINTERS:\n${JSON.stringify(ctx)}\n\nHISTORY:\n${historyText}\n\nOPERATOR:\n${heard}`,
          },
        ],
        { temperature: 0.4, timeoutMs: 45_000 },
      );
      plan = parseBrainPlan(data);
      if (!plan.reply && plan.tools.length === 0) plan = heuristicBrainPlan(heard, ctx);
    } catch {
      plan = heuristicBrainPlan(heard, ctx);
    }
  } else {
    plan = heuristicBrainPlan(heard, ctx);
  }

  const toolNotes: string[] = [];
  for (let round = 0; round < 3; round += 1) {
    if (!plan.tools.length) break;
    for (const tool of plan.tools.slice(0, 4)) {
      const output = await runJarvisTool(tool.name, tool.args, {
        lastLeadId: plan.lastLeadId ?? ctx.lastLeadId,
        lastDraftId: plan.lastDraftId ?? ctx.lastDraftId,
      });
      const serialized = JSON.stringify(output).slice(0, 6000);
      toolNotes.push(`${tool.name}: ${serialized}`);
      await appendJarvisMessage({
        threadId: thread.id,
        role: "TOOL",
        content: serialized.slice(0, 4000),
        toolName: tool.name,
        toolInput: tool.args as never,
        toolOutput: output as never,
      });
      const rec = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
      if (typeof rec.leadId === "string") ctx.lastLeadId = rec.leadId;
      if (typeof rec.recordId === "string") ctx.lastLeadRecordId = rec.recordId;
      if (typeof rec.company === "string") ctx.lastCompany = rec.company;
      if (typeof rec.id === "string" && tool.name === "get_draft") ctx.lastDraftId = rec.id;
      if (Array.isArray(output) && output[0] && typeof output[0] === "object") {
        const first = output[0] as Record<string, unknown>;
        if (typeof first.leadId === "string") ctx.lastLeadId = first.leadId;
        if (typeof first.company === "string") ctx.lastCompany = first.company;
      }
    }

    if (provider.configured) {
      try {
        const { data } = await generateJson<unknown>(
          provider,
          [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `KNOWLEDGE + DOCTRINE:\n${doctrine}\n\nLIVE POSTGRES:\n${snapshot.text}\n\nTOOL RESULTS:\n${toolNotes.join("\n")}\n\nOPERATOR:\n${heard}\nReturn final reply with tools: [].`,
            },
          ],
          { temperature: 0.45, timeoutMs: 45_000 },
        );
        plan = parseBrainPlan(data);
      } catch {
        plan = { reply: proseFromToolFacts(heard, snapshot.text), tools: [] };
      }
    } else {
      plan = { reply: proseFromToolFacts(heard, toolNotes.join(" ").slice(0, 800) || snapshot.text), tools: [] };
    }
  }

  const spoken = plan.reply || proseFromToolFacts(heard, snapshot.text);
  await appendJarvisMessage({ threadId: thread.id, role: "ASSISTANT", content: spoken });
  await updateJarvisThreadContext(thread.id, {
    lastLeadId: plan.lastLeadId ?? ctx.lastLeadId,
    lastLeadRecordId: ctx.lastLeadRecordId ?? null,
    lastDraftId: plan.lastDraftId ?? ctx.lastDraftId,
    lastCompany: plan.lastCompany ?? ctx.lastCompany,
    title: thread.title ?? heard.slice(0, 80),
  });

  return {
    threadId: thread.id,
    heard,
    spoken,
    intent: "JARVIS_BRAIN",
    summary: spoken,
    lastLeadId: plan.lastLeadId ?? ctx.lastLeadId ?? null,
    lastDraftId: plan.lastDraftId ?? ctx.lastDraftId ?? null,
    lastCompany: plan.lastCompany ?? ctx.lastCompany ?? null,
  };
}
