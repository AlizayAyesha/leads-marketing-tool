export type AgentContract = {
  slug: string;
  can: string[];
  cannot: string[];
  allowedTools: string[];
};

export const AGENT_CONTRACTS: AgentContract[] = [
  {
    slug: "orchestrator",
    can: ["understand operator intent", "create a task plan", "assign specialists"],
    cannot: ["send messages", "approve drafts", "fabricate leads"],
    allowedTools: [],
  },
  {
    slug: "intake",
    can: ["validate rows", "normalize fields", "deduplicate", "store leads"],
    cannot: ["send messages", "score leads", "invent companies"],
    allowedTools: ["google-sheets", "apify"],
  },
  {
    slug: "research",
    can: ["fetch public webpages", "extract evidence", "record limitations", "store a public LinkedIn URL found on the company website"],
    cannot: ["send messages", "approve itself", "bypass auth/CAPTCHA", "access arbitrary credentials"],
    allowedTools: ["website-research", "apify"],
  },
  {
    slug: "linkedin_research",
    can: ["normalize LinkedIn profile URLs", "call an authorized LinkedIn research provider", "store evidence with source URL and timestamp"],
    cannot: [
      "send LinkedIn messages",
      "send connection requests",
      "like, comment, or follow",
      "scrape LinkedIn",
      "use Chrome login as a workaround",
      "invent profile facts",
      "qualify leads",
    ],
    allowedTools: ["linkedin-research", "pdl-person"],
  },
  {
    slug: "instagram_research",
    can: ["normalize Instagram profile URLs", "call an authorized Instagram research provider", "store evidence with source URL and timestamp"],
    cannot: [
      "send Instagram DMs",
      "like, follow, or comment",
      "interact with stories",
      "scrape Instagram",
      "use Chrome login as a workaround",
      "invent profile facts",
      "qualify leads",
    ],
    allowedTools: ["instagram-research"],
  },
  {
    slug: "qualification",
    can: ["score from signals", "explain FIT/NEED/INTENT/TIMING/ACCESS", "list unknowns"],
    cannot: ["send messages", "modify scoring policy", "invent budget or intent", "re-run research"],
    allowedTools: [],
  },
  {
    slug: "signals",
    can: ["persist structured signals from stored evidence"],
    cannot: ["send messages", "qualify leads", "invent signals without evidence", "draft outreach"],
    allowedTools: [],
  },
  {
    slug: "decision_maker",
    can: [
      "audit stored email/LinkedIn/Instagram fields",
      "flag newbie vs established LinkedIn evidence",
      "flag professional vs personal Instagram evidence",
      "hold or reject leads before outreach drafts",
      "allow a non-professional lead only when they asked for a service we provide",
    ],
    cannot: [
      "send messages",
      "invent emails or profile facts",
      "scrape LinkedIn or Instagram live",
      "treat a missing profile as seniority proof",
      "approve drafts",
    ],
    allowedTools: [],
  },
  {
    slug: "opportunity",
    can: ["name a possible problem", "match a solution only after opportunity"],
    cannot: ["force a catalog item", "send messages", "change scores"],
    allowedTools: [],
  },
  {
    slug: "strategist",
    can: ["recommend channel and tone", "list what not to say"],
    cannot: ["send", "approve", "fabricate a request"],
    allowedTools: [],
  },
  {
    slug: "outreach_writer",
    can: ["read approved evidence", "create drafts", "recommend a CTA"],
    cannot: ["send", "fabricate evidence", "change lead score", "approve its own draft"],
    allowedTools: [],
  },
  {
    slug: "follow_up",
    can: ["suggest a follow-up from status"],
    cannot: ["send", "approve"],
    allowedTools: [],
  },
  {
    slug: "upwork",
    can: ["import listings", "read stored opportunities"],
    cannot: ["call unofficial APIs", "submit proposals"],
    allowedTools: ["upwork"],
  },
  {
    slug: "upwork_proposal",
    can: ["draft a proposal"],
    cannot: ["submit", "approve itself", "invent portfolio items"],
    allowedTools: [],
  },
  {
    slug: "fiverr",
    can: ["import gigs and inquiries"],
    cannot: ["send buyer messages", "claim keyword rankings", "scrape Fiverr search"],
    allowedTools: ["fiverr"],
  },
  {
    slug: "fiverr_intelligence",
    can: ["cluster imported buyer demand", "write market snapshots"],
    cannot: ["scrape Fiverr", "send", "auto-respond"],
    allowedTools: [],
  },
  {
    slug: "fiverr_optimizer",
    can: ["propose one gig experiment", "store funnel notes"],
    cannot: ["publish gig edits", "send messages", "submit gig changes", "approve its own experiment", "change a gig every day", "claim rankings"],
    allowedTools: [],
  },
  {
    slug: "fiverr_qualify",
    can: ["score a Fiverr request 0–100"],
    cannot: ["send", "approve a draft"],
    allowedTools: [],
  },
  {
    slug: "fiverr_response",
    can: ["draft a buyer reply after qualification"],
    cannot: ["send", "approve itself", "draft REJECT/HOLD requests"],
    allowedTools: [],
  },
  {
    slug: "fiverr_followup",
    can: ["draft one follow-up after 3 silent days"],
    cannot: ["send", "spam repeated follow-ups"],
    allowedTools: [],
  },
  {
    slug: "browser",
    can: [
      "navigate websites",
      "read visible public information",
      "read Google Sheets",
      "update approved enrichment spreadsheet fields",
      "download files",
      "fill forms",
      "prepare messages",
      "return structured results",
      "report browser errors",
    ],
    cannot: [
      "make qualification decisions",
      "invent evidence",
      "modify scoring policy",
      "approve its own work",
      "send unapproved messages",
      "submit proposals",
      "bypass the approval gate",
      "claim a submission succeeded without browser evidence",
      "hide browser errors",
      "bypass CAPTCHA or security mechanisms",
      "use stealth to evade platform controls",
    ],
    allowedTools: ["chrome"],
  },
];

export function contractFor(slug: string) {
  return AGENT_CONTRACTS.find((item) => item.slug === slug) ?? null;
}

export function agentMaySend(slug: string) {
  const contract = contractFor(slug);
  if (!contract) return false;
  return contract.can.some((item) => item === "send messages");
}
