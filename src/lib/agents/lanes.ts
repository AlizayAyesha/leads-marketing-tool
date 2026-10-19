export const AGENT_LANES = {
  revenueFiverr: [
    "fiverr",
    "fiverr_intelligence",
    "fiverr_optimizer",
    "fiverr_qualify",
    "fiverr_response",
    "fiverr_followup",
  ],
  revenueOutbound: [
    "intake",
    "research",
    "signals",
    "decision_maker",
    "qualification",
    "opportunity",
    "outreach_writer",
    "follow_up",
  ],
  supporting: ["strategist", "browser", "linkedin_research", "instagram_research", "orchestrator"],
  future: ["upwork", "upwork_proposal", "upwork_qualification"],
} as const;

export type AgentLane = keyof typeof AGENT_LANES;

export function laneForSlug(slug: string): AgentLane | "other" {
  for (const [lane, slugs] of Object.entries(AGENT_LANES) as [AgentLane, readonly string[]][]) {
    if (slugs.includes(slug)) return lane;
  }
  return "other";
}
