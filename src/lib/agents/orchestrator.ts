import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

import type { OutreachChannel, ZarService } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { generateJson } from "@/lib/ai/provider";
import { enqueue, processQueue } from "@/lib/queue/engine";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { isFreelanceCommand } from "@/lib/brain/capabilities";
import { triageFreelanceCommand } from "@/lib/brain/triage";
import { parseWorkforceCommand } from "@/lib/workforce/plan";
import { describeWorkforceJob, runWorkforceJob } from "@/lib/workforce/job";
import { parseApifyCommand } from "@/lib/apify/commands";
import { browserIntentFromCommand } from "@/lib/browser/intent";
import type { WorkforcePlan } from "@/lib/workforce/types";
import { buildExecutionBrief } from "@/lib/jarvis/execution-brief";
import type { JarvisCommandResult } from "@/types";

type Routed = {
  intent: string;
  filters: {
    temperature?: string | null;
    channel?: OutreachChannel | null;
    service?: string | null;
    limit?: number;
    leadId?: string | null;
    status?: string | null;
    importSheet?: boolean;
    url?: string | null;
  };
  summary: string;
};

const SERVICE_ALIASES: Record<string, ZarService> = {
  website: "WEBSITE_DEVELOPMENT",
  "web development": "WEBSITE_DEVELOPMENT",
  "full-stack": "FULL_STACK_DEVELOPMENT",
  saas: "SAAS_DEVELOPMENT",
  "ai automation": "AI_AUTOMATION",
  automation: "AI_AUTOMATION",
  chatbot: "AI_CHATBOTS",
  seo: "SEO",
  branding: "BRANDING",
  "ui/ux": "UI_UX",
};

export async function interpretCommand(command: string): Promise<JarvisCommandResult> {
  if (isFreelanceCommand(command)) {
    return triageFreelanceCommand(command);
  }
  const workforce = parseWorkforceCommand(command);
  if (workforce) {
    return executeWorkforce(workforce, command);
  }
  const apify = parseApifyCommand(command);
  if (apify) {
    return executeApifyCommand(apify, command);
  }
  const routed = (await routeWithAI(command)) ?? routeWithRules(command);
  if (routed.intent === "PROCESS_WORKFORCE" || routed.intent === "SIMULATE_CAMPAIGN") {
    return executeWorkforce(
      {
        intent: routed.intent,
        importSheet: Boolean(routed.filters.importSheet),
        limit: routed.filters.limit ?? 20,
        top: Math.min(8, routed.filters.limit ?? 20),
        simulate: routed.intent === "SIMULATE_CAMPAIGN",
        stages: [],
        opening: routed.summary,
      },
      command,
    );
  }
  return executeIntent(routed, command);
}

async function routeWithAI(command: string): Promise<Routed | null> {
  await refreshCredentialCache();
  const provider = getAIProvider();
  if (!provider.configured) return null;
  try {
    const { data } = await generateJson<Routed>(provider, [
      { role: "system", content: DEFAULT_PROMPTS.orchestrator.content },
      { role: "user", content: command },
    ]);
    return data;
  } catch {
    return null;
  }
}

function routeWithRules(command: string): Routed {
  const text = command.toLowerCase();
  const limit = Number(text.match(/top\s+(\d+)/)?.[1] ?? 20);
  const leadId = command.match(/ZJ-[A-Z0-9]+/i)?.[0] ?? null;
  const channel = /linkedin/.test(text)
    ? "LINKEDIN"
    : /instagram/.test(text)
      ? "INSTAGRAM"
      : /facebook/.test(text)
        ? "FACEBOOK"
        : /twitter|\bx\b/.test(text)
          ? "X_TWITTER"
          : /email/.test(text)
            ? "EMAIL"
            : null;
  const temperature = /hot/.test(text)
    ? "HOT"
    : /warm/.test(text)
      ? "WARM"
      : /cold/.test(text)
        ? "COLD"
        : null;

  const browser = browserIntentFromCommand(command);
  if (browser) {
    return {
      intent: browser.intent,
      filters: { leadId, url: browser.url },
      summary: browser.summary,
    };
  }
  if (
    /\b(execution( status)?|status of (the )?(outreach|execution)|what('?s| is) (the )?(outreach )?execution|how('?s| is) (the )?outreach( going)?|what('?s| is) running|brief me|standup)\b/.test(
      text,
    )
  ) {
    return {
      intent: "REPORT_EXECUTION",
      filters: {},
      summary: "Read the live execution: sequences, queue, send gates, and daily outreach.",
    };
  }
  if (/discover|find (more |new )?prospects|source (new )?leads/.test(text)) {
    return { intent: "DISCOVER_PROSPECTS", filters: { limit }, summary: "Discover licensed professional prospects. No LinkedIn login." };
  }
  if (/enrich/.test(text) && /linkedin|missing|url/.test(text)) {
    return { intent: "ENRICH_LEADS", filters: { limit }, summary: "Find missing LinkedIn person URLs for existing leads." };
  }
  if (/research/.test(text)) return { intent: "RESEARCH_NEW", filters: {}, summary: "Research new leads." };
  if (/outreach engine|handle (the )?outreach|leave it running|autonomous outreach|run (the )?(full )?outreach/.test(text)) {
    return { intent: "RUN_OUTREACH_ENGINE", filters: { limit, leadId, importSheet: /sheet/.test(text) }, summary: "Run the outreach engine with the Decision Maker as a hard gate." };
  }
  if (/supervis|decision maker|audit (the )?leads|verify (email|linkedin|instagram)|filter (the )?leads/.test(text)) {
    return { intent: "SUPERVISE_LEADS", filters: { limit, leadId }, summary: "Run the decision maker over stored leads." };
  }
  if (/qualif/.test(text)) return { intent: "QUALIFY", filters: {}, summary: "Qualify researched leads." };
  if (/explain/.test(text)) return { intent: "EXPLAIN_LEAD", filters: { leadId }, summary: "Explain why a lead is valuable." };
  if (/follow-?up/.test(text)) return { intent: "FOLLOW_UPS", filters: {}, summary: "Generate follow-up suggestions." };
  if (/queue|approv|awaiting (my )?review|drafts? (waiting|awaiting)|show me the drafts/.test(text)) {
    return { intent: "SHOW_QUEUE", filters: {}, summary: "Show the approval queue." };
  }
  if (/ai automation|need ai/.test(text)) return { intent: "FIND_AI", filters: { service: "AI_AUTOMATION" }, summary: "Find AI automation opportunities." };
  if (/prepare|outreach|draft/.test(text)) {
    return { intent: "PREPARE_OUTREACH", filters: { channel, temperature, limit }, summary: "Prepare outreach drafts." };
  }
  if (/top|highest|best/.test(text) || /web development/.test(text)) {
    return {
      intent: /web development|website/.test(text) ? "FIND_SERVICE" : "TOP_LEADS",
      filters: { limit, service: /web/.test(text) ? "WEBSITE_DEVELOPMENT" : null, temperature },
      summary: "Show the highest-quality matching leads.",
    };
  }
  return { intent: "UNKNOWN", filters: { limit }, summary: "I could not map that command to a task." };
}

async function executeIntent(routed: Routed, command: string): Promise<JarvisCommandResult> {
  const taskIds: string[] = [];
  const leadIds: string[] = [];
  const filters = routed.filters ?? {};

  if (routed.intent === "REPORT_EXECUTION") {
    const summary = await buildExecutionBrief();
    return { intent: routed.intent, summary, taskIds, leadIds };
  }

  if (routed.intent === "EXPORT_SHEET") {
    const task = await enqueue({ type: "EXPORT_SHEET" });
    taskIds.push(task.id);
    await processQueue(1);
    return { intent: routed.intent, summary: routed.summary, taskIds, leadIds };
  }

  if (routed.intent === "BROWSER_NAVIGATE") {
    let url = typeof filters.url === "string" && filters.url.startsWith("http") ? filters.url : null;
    if (filters.url === "sheet") {
      const source = await prisma.leadSource.findFirst({ where: { type: "GOOGLE_SHEETS" } });
      const spreadsheetId =
        source?.config && typeof source.config === "object"
          ? String((source.config as { spreadsheetId?: string }).spreadsheetId ?? "")
          : "";
      url = spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : null;
    }
    if (filters.url === "lead-website" && filters.leadId) {
      const lead = await prisma.lead.findFirst({ where: { leadId: filters.leadId } });
      url = lead?.website ?? null;
      if (lead) leadIds.push(lead.leadId);
    }
    if (!url) {
      return {
        intent: routed.intent,
        summary: "No URL is available. Configure a Google Sheet or provide a lead ID with a website.",
        taskIds,
        leadIds,
      };
    }
    const task = await enqueue({
      type: "BROWSER_TASK",
      payload: { action: "navigate", url, simulate: false },
    });
    taskIds.push(task.id);
    await processQueue(1);
    return {
      intent: routed.intent,
      summary: `Queued Jarvis Chrome to open ${url}. Chrome must be connected. This is navigation, not a send.`,
      taskIds,
      leadIds,
    };
  }

  if (routed.intent === "IMPORT_LEADS") {
    const task = await enqueue({ type: "IMPORT_SHEET" });
    taskIds.push(task.id);
    await processQueue(1);
    return { intent: routed.intent, summary: routed.summary, taskIds, leadIds };
  }

  if (routed.intent === "DISCOVER_PROSPECTS") {
    const { discoverProspects } = await import("@/lib/discovery/search");
    const result = await discoverProspects({ limit: filters.limit });
    if (!result.ok) {
      return { intent: routed.intent, summary: result.error, taskIds, leadIds };
    }
    for (const leadId of result.leadIds) {
      const task = await enqueue({ type: "PIPELINE_LEAD", leadId });
      taskIds.push(task.id);
    }
    leadIds.push(...(result.publicLeadIds ?? []));
    if (result.leadIds.length) await processQueue(3);
    return {
      intent: routed.intent,
      summary: `Discovered ${result.stored} new prospects (${result.duplicates} duplicates). Pipeline queued. Jarvis will not send or change LinkedIn connection states until Decision Maker PASS.`,
      taskIds,
      leadIds,
      data: result,
    };
  }

  if (routed.intent === "ENRICH_LEADS") {
    const { identifyMissingLinkedIn } = await import("@/lib/enrichment/identify");
    const result = await identifyMissingLinkedIn({ limit: filters.limit });
    if (!result.ok) {
      return { intent: routed.intent, summary: result.error, taskIds, leadIds };
    }
    const wrote = result.results.filter((item) => item.wrote);
    for (const row of wrote) {
      const task = await enqueue({ type: "PIPELINE_LEAD", leadId: row.leadId });
      taskIds.push(task.id);
      leadIds.push(row.publicLeadId);
    }
    if (wrote.length) await processQueue(3);
    return {
      intent: routed.intent,
      summary: `Looked up ${result.selected} existing leads. Wrote ${wrote.length} LinkedIn person URLs. Pipeline queued for those matches. No sends.`,
      taskIds,
      leadIds,
      data: result,
    };
  }

  if (routed.intent === "RESEARCH_NEW") {
    const leads = await prisma.lead.findMany({
      where: { status: "NEW", suppressed: false },
      take: 25,
    });
    for (const lead of leads) {
      const task = await enqueue({ type: "RESEARCH_LEAD", leadId: lead.id });
      taskIds.push(task.id);
      leadIds.push(lead.leadId);
    }
    await processQueue(5);
    return { intent: routed.intent, summary: `Queued research for ${leads.length} new leads.`, taskIds, leadIds };
  }

  if (routed.intent === "QUALIFY") {
    const leads = await prisma.lead.findMany({
      where: { status: { in: ["NEW", "RESEARCHED"] }, suppressed: false },
      take: 25,
    });
    for (const lead of leads) {
      const task = await enqueue({ type: "QUALIFY_LEAD", leadId: lead.id });
      taskIds.push(task.id);
      leadIds.push(lead.leadId);
    }
    await processQueue(5);
    return { intent: routed.intent, summary: `Queued qualification for ${leads.length} leads.`, taskIds, leadIds };
  }

  if (routed.intent === "SUPERVISE_LEADS") {
    const leads = filters.leadId
      ? await prisma.lead.findMany({ where: { leadId: filters.leadId }, take: 1 })
      : await prisma.lead.findMany({
          where: { suppressed: false, status: { notIn: ["DO_NOT_CONTACT", "LOST", "WON"] } },
          take: filters.limit ?? 25,
          orderBy: { lastActivityAt: "desc" },
        });
    for (const lead of leads) {
      const task = await enqueue({ type: "AUDIT_LEAD", leadId: lead.id });
      taskIds.push(task.id);
      leadIds.push(lead.leadId);
    }
    await processQueue(5);
    return {
      intent: routed.intent,
      summary: `Queued the decision maker on ${leads.length} leads. It checks email, LinkedIn, Instagram, and service need before drafts.`,
      taskIds,
      leadIds,
    };
  }

  if (routed.intent === "RUN_OUTREACH_ENGINE") {
    const { runOutreachEngine } = await import("@/lib/outreach/engine");
    const funnel = await runOutreachEngine({
      limit: filters.limit ?? 10,
      importSheet: Boolean(filters.importSheet),
      command,
      leadIds: filters.leadId ? [filters.leadId] : undefined,
    });
    return {
      intent: routed.intent,
      summary: `Outreach engine scanned ${funnel.scanned}: ${funnel.passed} PASS, ${funnel.held} HOLD, ${funnel.rejected} REJECT, ${funnel.enrolled} sequenced, ${funnel.sent} sent. HOLD/REJECT never message. Sends stay blocked while the kill switch is on.`,
      taskIds,
      leadIds: funnel.leadIds,
      data: funnel,
    };
  }

  if (routed.intent === "PREPARE_OUTREACH") {
    const leads = await prisma.lead.findMany({
      where: {
        suppressed: false,
        status: { notIn: ["DO_NOT_CONTACT", "LOST", "WON"] },
        temperature: filters.temperature ? (filters.temperature as never) : undefined,
        email: filters.channel === "EMAIL" ? { not: null } : undefined,
        linkedinUrl: filters.channel === "LINKEDIN" ? { not: null } : undefined,
      },
      take: filters.limit ?? 20,
      orderBy: { lastActivityAt: "desc" },
    });
    for (const lead of leads) {
      const task = await enqueue({
        type: "PIPELINE_LEAD",
        leadId: lead.id,
        payload: { channel: filters.channel },
      });
      taskIds.push(task.id);
      leadIds.push(lead.leadId);
    }
    await processQueue(3);
    return {
      intent: routed.intent,
      summary: `Prepared outreach pipeline for ${leads.length} leads.`,
      taskIds,
      leadIds,
    };
  }

  if (routed.intent === "FOLLOW_UPS") {
    const leads = await prisma.lead.findMany({
      where: { status: "CONTACTED" },
      take: 20,
    });
    for (const lead of leads) {
      const task = await enqueue({ type: "FOLLOW_UP_LEAD", leadId: lead.id });
      taskIds.push(task.id);
      leadIds.push(lead.leadId);
    }
    await processQueue(5);
    return { intent: routed.intent, summary: `Generated follow-up suggestions for ${leads.length} contacted leads.`, taskIds, leadIds };
  }

  if (routed.intent === "EXPLAIN_LEAD") {
    const lead = filters.leadId
      ? await prisma.lead.findFirst({
          where: { leadId: filters.leadId },
          include: {
            scores: { orderBy: { createdAt: "desc" }, take: 1 },
            opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
            research: { orderBy: { createdAt: "desc" }, take: 1 },
            audits: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        })
      : null;
    return {
      intent: routed.intent,
      summary: lead
        ? `${lead.leadId} is ${lead.temperature ?? "unscored"} (${lead.scores[0]?.score ?? "n/a"}). Decision maker: ${lead.audits[0]?.verdict ?? "not run"}. ${lead.audits[0]?.summary ?? lead.scores[0]?.reason ?? "Run qualification and the decision maker."}`
        : "Provide a lead ID like ZJ-XXXXXXXX.",
      taskIds,
      leadIds: lead ? [lead.leadId] : [],
      data: lead,
    };
  }

  if (routed.intent === "SHOW_QUEUE") {
    const drafts = await prisma.outreachDraft.findMany({
      where: { status: { in: ["PENDING_APPROVAL", "EDITED"] } },
      include: { lead: true },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    return {
      intent: routed.intent,
      summary: `${drafts.length} drafts are waiting for human approval.`,
      taskIds,
      leadIds: drafts.map((item) => item.lead.leadId),
      data: drafts.map((item) => ({
        leadId: item.lead.leadId,
        lead: item.lead.name,
        company: item.lead.company,
        channel: item.channel,
        status: item.status,
        draft: item.message,
      })),
    };
  }

  if (routed.intent === "TOP_LEADS" || routed.intent === "FIND_SERVICE" || routed.intent === "FIND_AI") {
    const service =
      (filters.service && SERVICE_ALIASES[filters.service.toLowerCase()]) ||
      (filters.service as ZarService | null) ||
      (routed.intent === "FIND_AI" ? "AI_AUTOMATION" : null);
    const leads = await prisma.lead.findMany({
      where: {
        suppressed: false,
        temperature: filters.temperature ? (filters.temperature as never) : undefined,
        opportunities: service ? { some: { recommendedService: service } } : undefined,
      },
      include: {
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastActivityAt: "desc" },
      take: filters.limit ?? 20,
    });
    leads.sort((a, b) => (b.scores[0]?.score ?? 0) - (a.scores[0]?.score ?? 0));
    return {
      intent: routed.intent,
      summary: `Found ${leads.length} matching leads.`,
      taskIds,
      leadIds: leads.map((lead) => lead.leadId),
      data: leads.map((lead) => ({
        leadId: lead.leadId,
        company: lead.company,
        score: lead.scores[0]?.score ?? null,
        service: lead.opportunities[0]?.recommendedService ?? null,
      })),
    };
  }

  return {
    intent: "UNKNOWN",
    summary: `I heard “${command}” but could not map it to a task. Try: “Find me 20 companies that could need ${getBusinessProfile().businessName}”, “Run my lead scraping actors”, “Simulate campaign”, import today's leads, or show the approval queue.`,
    taskIds,
    leadIds,
  };
}

async function executeApifyCommand(
  plan: ReturnType<typeof parseApifyCommand> & object,
  command: string,
): Promise<JarvisCommandResult> {
  if (!plan) {
    return { intent: "UNKNOWN", summary: "No Apify Actors to run.", taskIds: [], leadIds: [] };
  }
  const task = await enqueue({
    type: "RUN_APIFY_ACTORS",
    payload: {
      actorQuery: plan.actorQuery,
      testMode: plan.testMode,
      ingest: true,
      pipeline: plan.pipeline,
      limit: plan.limit,
      command,
    },
    timeoutMs: 240_000,
  });
  const processed = await processQueue(1);
  const output = processed[0] as { output?: { note?: string; leadIds?: string[]; successful?: number; failed?: number } } | undefined;
  const data = output?.output;
  return {
    intent: plan.intent,
    summary:
      data && typeof data === "object" && "note" in data
        ? String((data as { note?: string }).note ?? plan.opening)
        : plan.opening,
    taskIds: [task.id],
    leadIds: Array.isArray((data as { leadIds?: string[] } | undefined)?.leadIds)
      ? ((data as { leadIds: string[] }).leadIds)
      : [],
    data,
  };
}

async function executeWorkforce(plan: WorkforcePlan, command: string): Promise<JarvisCommandResult> {
  const funnel = await runWorkforceJob({ ...plan, command });
  return {
    intent: plan.intent,
    summary: describeWorkforceJob(funnel, plan.opening),
    taskIds: [],
    leadIds: funnel.leadIds,
    data: funnel,
  };
}
