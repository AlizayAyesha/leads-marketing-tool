import { JARVIS_TOOL_NAMES } from "@/lib/jarvis/tools-catalog";

export type BrainPlan = {
  reply: string;
  tools: { name: string; args: Record<string, unknown> }[];
  lastLeadId?: string | null;
  lastDraftId?: string | null;
  lastCompany?: string | null;
};

export function parseBrainPlan(raw: unknown): BrainPlan {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const toolsIn = Array.isArray(row.tools) ? row.tools : [];
  const tools = toolsIn
    .map((item) => {
      const t = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = String(t.name ?? "");
      const args = t.args && typeof t.args === "object" ? (t.args as Record<string, unknown>) : {};
      if (!JARVIS_TOOL_NAMES.includes(name as (typeof JARVIS_TOOL_NAMES)[number])) return null;
      return { name, args };
    })
    .filter((item): item is { name: string; args: Record<string, unknown> } => Boolean(item));
  return {
    reply: String(row.reply ?? "").trim(),
    tools,
    lastLeadId: row.lastLeadId == null ? null : String(row.lastLeadId),
    lastDraftId: row.lastDraftId == null ? null : String(row.lastDraftId),
    lastCompany: row.lastCompany == null ? null : String(row.lastCompany),
  };
}

export function heuristicBrainPlan(
  userText: string,
  ctx: { lastLeadId?: string | null; lastDraftId?: string | null },
): BrainPlan {
  const text = userText.toLowerCase();
  if (/\bsend\b/.test(text)) {
    return {
      reply: "",
      tools: [{ name: "request_send", args: { draftId: ctx.lastDraftId ?? "", command: userText } }],
      lastDraftId: ctx.lastDraftId,
    };
  }
  if (/\b(which ones?|why (that|this)|that lead|that one|the company)\b/.test(text) && (ctx.lastLeadId || /\bZJ-/i.test(userText))) {
    return {
      reply: "",
      tools: [{ name: "get_lead", args: { leadId: ctx.lastLeadId ?? userText } }],
      lastLeadId: ctx.lastLeadId,
    };
  }
  if (/prepare|draft|less salesy|make it/.test(text)) {
    return { reply: "", tools: [{ name: "execute_intent", args: { command: userText } }] };
  }
  if (/should i|focus on today|bottleneck|what happened|sales today|execution|strongest opportunit|haven't worked/.test(text)) {
    return {
      reply: "",
      tools: [
        { name: "get_execution_brief", args: {} },
        { name: "get_analytics", args: {} },
        { name: "list_opportunities", args: {} },
      ],
    };
  }
  if (/research|qualify|outreach|sheet|fiverr|upwork|discover|supervis/.test(text)) {
    return { reply: "", tools: [{ name: "execute_intent", args: { command: userText } }] };
  }
  return { reply: "", tools: [{ name: "get_execution_brief", args: {} }, { name: "get_analytics", args: {} }] };
}

export function proseFromToolFacts(userText: string, facts: string) {
  const askedMetrics = /metric|numbers|imported|count|json/i.test(userText);
  if (askedMetrics) return facts.slice(0, 1200);
  return [
    "FACT: I used the live pipeline, not a canned command.",
    facts.slice(0, 420),
    "INFERENCE: researched volume without commercial ≥80 Send Ready is not progress.",
    "UNKNOWN: I will not name a Send-Ready account unless the tools showed one that actually clears the gates.",
    "RECOMMENDATION: stop expanding discovery; re-audit the strongest existing accounts; verify decision makers; get one legitimate 80+ opportunity to Send Ready before another broad campaign.",
    "I will not send from this chat unless the existing approval gates pass.",
  ].join(" ");
}
