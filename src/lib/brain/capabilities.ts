export const CAPABILITIES = [
  "find_freelance_opportunities",
  "qualify_freelance_opportunity",
  "prepare_upwork_proposal",
  "analyze_fiverr_gigs",
  "optimize_fiverr_gig",
  "draft_fiverr_response",
  "compare_freelance_platforms",
  "list_unanswered_opportunities",
  "analyze_fiverr_market",
  "follow_up_fiverr",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type CapabilityMatch = {
  capability: Capability;
  platform?: "upwork" | "fiverr" | "any";
  query?: string;
  serviceHint?: string;
  budgetMax?: number;
};

export function matchFreelanceCommand(command: string): CapabilityMatch | null {
  const text = command.toLowerCase();
  const platform = /upwork/.test(text)
    ? "upwork"
    : /fiverr/.test(text)
      ? "fiverr"
      : "any";
  const budgetMax = Number(text.match(/under\s*\$?\s*([\d,]+)/)?.[1]?.replaceAll(",", "") ?? "");
  const serviceHint = /ai automation|automation/.test(text)
    ? "AI_AUTOMATION"
    : /saas/.test(text)
      ? "SAAS_DEVELOPMENT"
      : /web(site)?|web development/.test(text)
        ? "WEBSITE_DEVELOPMENT"
        : undefined;

  if (/which platform|performing better|best platform/.test(text)) {
    return { capability: "compare_freelance_platforms", platform: "any" };
  }
  if (/haven.?t responded|unanswered|not responded/.test(text)) {
    return { capability: "list_unanswered_opportunities", platform };
  }
  if (/follow[- ]?up/.test(text) && /fiverr/.test(text)) {
    return { capability: "follow_up_fiverr", platform: "fiverr", query: command };
  }
  if (/market|what are buyers buying|demand/.test(text) && /fiverr/.test(text)) {
    return { capability: "analyze_fiverr_market", platform: "fiverr", query: command };
  }
  if (/improve|optimize/.test(text) && /gig/.test(text)) {
    return { capability: "optimize_fiverr_gig", platform: "fiverr", query: command, serviceHint };
  }
  if (/analyze/.test(text) && /gig/.test(text)) {
    return { capability: "analyze_fiverr_gigs", platform: "fiverr", query: command };
  }
  if (/buyer|inquiry|inquir/.test(text) && /fiverr|response|reply/.test(text)) {
    return { capability: "draft_fiverr_response", platform: "fiverr", query: command };
  }
  if (/proposal/.test(text)) {
    return { capability: "prepare_upwork_proposal", platform: platform === "fiverr" ? "fiverr" : "upwork", query: command, serviceHint };
  }
  if (
    /upwork|fiverr|freelance|\bgigs?\b/.test(text) ||
    /best opportunities today|find me .*work/.test(text)
  ) {
    return {
      capability: "find_freelance_opportunities",
      platform,
      query: command,
      serviceHint,
      budgetMax: Number.isFinite(budgetMax) && budgetMax > 0 ? budgetMax : undefined,
    };
  }
  return null;
}

export function isFreelanceCommand(command: string) {
  return matchFreelanceCommand(command) !== null;
}
