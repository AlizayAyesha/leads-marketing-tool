import type { Lead } from "@prisma/client";

export type AgentContext = {
  lead?: Lead;
  payload?: Record<string, unknown>;
  prompt: string;
  abortSignal?: AbortSignal;
};

export type AgentResult = {
  ok: boolean;
  output: unknown;
  error?: string;
  mode: "openai" | "heuristic";
  promptVersion?: number | null;
  modelProvider?: string | null;
};

export interface SpecializedAgent {
  slug: string;
  name: string;
  description: string;
  execute(ctx: AgentContext): Promise<AgentResult>;
}

export const AGENT_DEFINITIONS = [
  {
    slug: "orchestrator",
    name: "Orchestrator Agent",
    description: "Translates Jarvis commands into agent tasks and pipeline runs.",
  },
  {
    slug: "intake",
    name: "Lead Intake Agent",
    description: "Normalizes, deduplicates, validates, and stores incoming leads.",
  },
  {
    slug: "research",
    name: "Lead Research Agent",
    description: "Collects public website evidence and identifies observed opportunities.",
  },
  {
    slug: "linkedin_research",
    name: "LinkedIn Research Agent",
    description: "Stores authorized LinkedIn research evidence. Does not scrape or send.",
  },
  {
    slug: "instagram_research",
    name: "Instagram Research Agent",
    description: "Stores authorized Instagram research evidence. Does not scrape, DM, or send.",
  },
  {
    slug: "qualification",
    name: "Lead Qualification Agent",
    description: "Scores leads 0–100 and classifies HOT / WARM / COLD / DISQUALIFIED.",
  },
  {
    slug: "signals",
    name: "Signal Agent",
    description: "Persists structured evidenced signals from stored lead and research records.",
  },
  {
    slug: "decision_maker",
    name: "Decision Maker Agent",
    description:
      "Supervises lead quality: professional fit, email, LinkedIn seniority, Instagram presence, and service need.",
  },
  {
    slug: "opportunity",
    name: "Opportunity Agent",
    description: "Maps observed problems to the most relevant your business service.",
  },
  {
    slug: "strategist",
    name: "Marketing Strategist Agent",
    description: "Chooses channel, tone, timing, and what must not be said.",
  },
  {
    slug: "outreach_writer",
    name: "Outreach Writer Agent",
    description: "Writes evidence-based drafts for human approval. Never sends.",
  },
  {
    slug: "follow_up",
    name: "Follow-Up Agent",
    description: "Suggests follow-ups from outreach status. Sending is Phase 3.",
  },
  {
    slug: "upwork",
    name: "Upwork Agent",
    description: "Researches imported Upwork listings. Official API search is unavailable until connected.",
  },
  {
    slug: "upwork_qualification",
    name: "Upwork Qualification Agent",
    description: "Scores freelance opportunities 0–100 for your business fit.",
  },
  {
    slug: "upwork_proposal",
    name: "Upwork Proposal Agent",
    description: "Drafts proposals for human approval. Never submits.",
  },
  {
    slug: "fiverr",
    name: "Fiverr Agent",
    description: "Imports Fiverr gigs and buyer inquiries. Does not scrape or send.",
  },
  {
    slug: "fiverr_intelligence",
    name: "Fiverr Market Intelligence Agent",
    description: "Clusters imported buyer demand. Does not scrape Fiverr search.",
  },
  {
    slug: "fiverr_optimizer",
    name: "Fiverr Gig Optimizer Agent",
    description: "Proposes one gig experiment at a time. Never auto-publishes daily changes.",
  },
  {
    slug: "fiverr_qualify",
    name: "Fiverr Qualification Agent",
    description: "Scores Fiverr buyers 0–100. Micro-gigs are rejected.",
  },
  {
    slug: "fiverr_response",
    name: "Fiverr Response Agent",
    description: "Drafts evidence-based buyer replies for approval. Never sends.",
  },
  {
    slug: "fiverr_followup",
    name: "Fiverr Follow-Up Agent",
    description: "One conservative follow-up draft after silence. Never sends.",
  },
  {
    slug: "browser",
    name: "Browser Agent",
    description: "Operates Jarvis Chrome as a tool. Does not qualify leads or send unapproved messages.",
  },
] as const;

export type AgentSlug = (typeof AGENT_DEFINITIONS)[number]["slug"];

export function asLeadRecord(lead: Lead) {
  return {
    leadId: lead.leadId,
    name: lead.name,
    company: lead.company,
    website: lead.website,
    email: lead.email,
    phone: lead.phone,
    linkedinUrl: lead.linkedinUrl,
    instagramUrl: lead.instagramUrl,
    facebookUrl: lead.facebookUrl,
    twitterUrl: lead.twitterUrl,
    source: lead.source,
    location: lead.location,
    industry: lead.industry,
    originalPost: lead.originalPost,
    notes: lead.notes,
    status: lead.status,
    missingFields: lead.missingFields,
  };
}
