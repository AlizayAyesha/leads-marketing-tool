import { getEnv, integrationStatus } from "@/lib/env";
import { getChromeSession } from "@/lib/tools/chrome";

export type OperationalState = "operational" | "draft_only" | "connected_pending" | "unavailable" | "architecture_only";

export type OperationalCapability = {
  id: string;
  name: string;
  desk: "brain" | "marketing" | "freelance" | "tools";
  state: OperationalState;
  detail: string;
};

export async function operationalCapabilities(): Promise<OperationalCapability[]> {
  const env = getEnv();
  const integrations = integrationStatus();
  const chrome = getChromeSession();
  return [
    {
      id: "command",
      name: "Jarvis commands",
      desk: "brain",
      state: "operational",
      detail: "Turns one sentence into a task graph. Does not send messages.",
    },
    {
      id: "workforce",
      name: "Workforce job / simulate campaign",
      desk: "brain",
      state: "operational",
      detail: "Import → research (parallel) → qualify → top drafts. Always 0 sent.",
    },
    {
      id: "lead_pipeline",
      name: "Lead research → score → draft",
      desk: "marketing",
      state: env.openaiKey ? "operational" : "draft_only",
      detail: env.openaiKey
        ? "OpenAI interprets evidence via OpenAIProvider. Structured scores stay deterministic."
        : "Heuristic mode unless an OpenAI credential is added in Settings → AI.",
    },
    {
      id: "approval",
      name: "Human approval",
      desk: "marketing",
      state: "operational",
      detail: "Approve records a decision. External send is blocked server-side.",
    },
    {
      id: "decision_maker",
      name: "Decision maker",
      desk: "marketing",
      state: "operational",
      detail:
        "Audits email, LinkedIn seniority, Instagram professionalism, and service need. REJECT/HOLD block drafts. Does not scrape LinkedIn/Instagram live.",
    },
    {
      id: "pdl_research",
      name: "Discover → Enrich (PDL)",
      desk: "marketing",
      state: env.pdlApiKey ? "operational" : "unavailable",
      detail: env.pdlApiKey
        ? "Licensed person search and LinkedIn URL enrichment. Discover/lookup daily caps are ceilings. No LinkedIn login."
        : "No PDL_API_KEY. Website LinkedIn extraction still runs during research. LinkedIn seniority stays unproven without a licensed provider.",
    },
    {
      id: "google_sheets",
      name: "Google Sheets workspace",
      desk: "tools",
      state: integrations.google.configured ? "connected_pending" : "unavailable",
      detail: integrations.google.configured
        ? "OAuth client present. Connect an account to import tabs."
        : "No OAuth client. CSV and manual intake still work.",
    },
    {
      id: "apify",
      name: "Apify actors",
      desk: "tools",
      state: integrations.apify.configured ? "operational" : "unavailable",
      detail: integrations.apify.configured
        ? "Actor Manager can run configured actors."
        : "No token — adapter will not fake a run.",
    },
    {
      id: "upwork",
      name: "Upwork environment",
      desk: "freelance",
      state: "draft_only",
      detail: "Import/score/draft only. Official search/submit unavailable.",
    },
    {
      id: "fiverr",
      name: "Fiverr environment",
      desk: "freelance",
      state: "draft_only",
      detail: "Gig/inquiry drafts only. Official API unavailable.",
    },
    {
      id: "email_send",
      name: "Email send",
      desk: "tools",
      state: "draft_only",
      detail:
        "Gmail send exists behind kill switch, daily limit, Decision Maker PASS, and APPROVED. Default is paused / draft-only.",
    },
    {
      id: "linkedin_send",
      name: "LinkedIn send",
      desk: "tools",
      state: chrome.status === "CONNECTED" ? "operational" : "unavailable",
      detail:
        chrome.status === "CONNECTED"
          ? "Jarvis operates the signed-in LinkedIn account in this Chrome session. Daily ON, bulk daily ceilings, Decision Maker, REQUESTED ≠ CONNECTED, and the global kill switch still apply."
          : "Connect Jarvis Chrome from Integrations → Chrome and sign into LinkedIn. Daily ON still respects qualification, bulk daily ceilings, REQUESTED ≠ CONNECTED, and the global kill switch.",
    },
    {
      id: "browser",
      name: "Jarvis Chrome",
      desk: "tools",
      state: chrome.status === "CONNECTED" ? "operational" : "unavailable",
      detail:
        chrome.status === "CONNECTED"
          ? "Dedicated Chrome session is connected. LinkedIn account actions use this session. Generic browser sends still need approval."
          : "DISCONNECTED until Connect succeeds on this machine. No stealth or CAPTCHA bypass.",
    },
  ];
}
