/**
 * Default X search terms aimed at people seeking services (override via Business Profile services)
 * (custom software, AI automation, web/apps, integrations).
 * Discovery only — does not make a lead outreach-eligible.
 */

export const DEFAULT_X_INTENT_QUERIES = [
  `"looking for" (developer OR "web developer" OR "software developer" OR freelancer)`,
  `"need a" (developer OR "web developer" OR "full stack" OR agency)`,
  `"hiring" ("web developer" OR "software engineer" OR "full stack")`,
  `"looking for" ("AI automation" OR "AI agent" OR chatbot OR "custom software")`,
  `"need help" (website OR "web app" OR SaaS OR automation)`,
  `"recommend" (developer OR agency) (website OR software OR automation)`,
  `"anyone know" (developer OR agency) (build OR website OR app)`,
  `"looking to hire" (developer OR agency OR "AI")`,
] as const;

export type TwitterIntentMatch = {
  ok: boolean;
  reason: string;
  serviceHints: string[];
};

const BUY_INTENT =
  /\b(looking for|looking to hire|need a|need an|need help|anyone recommend|can anyone recommend|looking for an agency|want to hire|i need|we('?re| are) looking|we('?re| are) hiring|need someone)\b/i;

const SERVICE_NEEDLES: Array<{ hint: string; re: RegExp }> = [
  { hint: "custom_software", re: /\b(custom software|software (build|dev|development)|build (an? )?app)\b/i },
  { hint: "website", re: /\b(website|landing page|web design|web(site)? (dev|developer|development))\b/i },
  { hint: "web_app", re: /\b(web app|full[- ]?stack|saas|dashboard)\b/i },
  { hint: "ai_automation", re: /\b(ai automation|ai agent|ai employee|chatbot|workflow automation|agentic)\b/i },
  { hint: "integrations", re: /\b(api integration|integrat(e|ion)|zapier|make\.com)\b/i },
  { hint: "developer", re: /\b(developer|engineer|agency|freelancer)\b/i },
];

/** Sellers, job seekers, and corporate ATS posts — not your business buyers. */
const EXCLUDE =
  /\b(looking for a job|hiring me|my (resume|cv)|open to work|job seeker|unemployed|open for commissions|available for (freelance|hire|work)|dm me for|hire me|i('?m| am) (a |an )?(developer|designer|freelancer)|apply now|careers?@|guidewire|t\. wts wtb|#HireMe)\b/i;

export function matchTwitterServiceIntent(text: string | null | undefined): TwitterIntentMatch {
  const body = (text ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return { ok: false, reason: "Empty tweet.", serviceHints: [] };
  if (EXCLUDE.test(body)) {
    return { ok: false, reason: "Looks like a seller, job seeker, or job board — not a buyer.", serviceHints: [] };
  }
  if (!BUY_INTENT.test(body)) {
    return { ok: false, reason: "No first-person buying / hiring intent language.", serviceHints: [] };
  }
  const serviceHints = SERVICE_NEEDLES.filter((item) => item.re.test(body)).map((item) => item.hint);
  if (!serviceHints.length) {
    return { ok: false, reason: "Intent present but no your business service match.", serviceHints: [] };
  }
  return {
    ok: true,
    reason: `Intent + service hints: ${serviceHints.join(", ")}`,
    serviceHints,
  };
}

export function buildTwitterSearchInput(input: {
  maxItems?: number;
  queries?: string[];
}): Record<string, unknown> {
  const maxItems = Math.min(Math.max(input.maxItems ?? 40, 5), 100);
  const searchTerms = (input.queries?.length ? input.queries : [...DEFAULT_X_INTENT_QUERIES]).slice(0, 8);
  return {
    searchTerms,
    maxItems,
    sort: "Latest",
    tweetLanguage: "en",
  };
}
