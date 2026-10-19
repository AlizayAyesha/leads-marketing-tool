import type { Capability, CapabilityMatch } from "@/lib/brain/capabilities";

export type PlannedTask = {
  id: string;
  goal: string;
  agentId: string;
  capability: string;
  type: string;
  payload: Record<string, unknown>;
  parallelGroup: number;
};

const CATALOG: Record<
  Capability,
  { agentId: string; platform: "upwork" | "fiverr" | "any"; type: string; goal: string }[]
> = {
  find_freelance_opportunities: [
    { agentId: "upwork", platform: "upwork", type: "search", goal: "Search permitted Upwork opportunities." },
    { agentId: "fiverr", platform: "fiverr", type: "search", goal: "Read stored Fiverr gigs/inquiries." },
    { agentId: "fiverr_intelligence", platform: "fiverr", type: "market", goal: "Cluster imported Fiverr buyer demand." },
  ],
  qualify_freelance_opportunity: [
    { agentId: "upwork_qualification", platform: "upwork", type: "qualify", goal: "Score stored Upwork opportunities." },
    { agentId: "fiverr_qualify", platform: "fiverr", type: "qualify", goal: "Score stored Fiverr requests." },
  ],
  prepare_upwork_proposal: [
    { agentId: "upwork_proposal", platform: "upwork", type: "prepare_best", goal: "Prepare proposals for the best Upwork projects." },
  ],
  analyze_fiverr_gigs: [
    { agentId: "fiverr_optimizer", platform: "fiverr", type: "optimize", goal: "Analyze stored Fiverr gigs." },
  ],
  analyze_fiverr_market: [
    { agentId: "fiverr_intelligence", platform: "fiverr", type: "market", goal: "What are imported Fiverr buyers asking for?" },
  ],
  optimize_fiverr_gig: [
    { agentId: "fiverr_optimizer", platform: "fiverr", type: "optimize", goal: "Propose one gig experiment worth testing." },
  ],
  draft_fiverr_response: [
    { agentId: "fiverr_response", platform: "fiverr", type: "draft_open", goal: "Draft replies for qualified unanswered inquiries." },
  ],
  follow_up_fiverr: [
    { agentId: "fiverr_followup", platform: "fiverr", type: "follow_up", goal: "Draft one conservative follow-up after silence." },
  ],
  compare_freelance_platforms: [
    { agentId: "analytics", platform: "any", type: "compare_freelance_platforms", goal: "Compare stored platform performance." },
  ],
  list_unanswered_opportunities: [
    { agentId: "analytics", platform: "any", type: "list_unanswered_opportunities", goal: "List opportunities without a response." },
  ],
};

export function planFreelanceWork(match: CapabilityMatch): PlannedTask[] {
  const payload = {
    query: match.query,
    serviceHint: match.serviceHint,
    budgetMax: match.budgetMax,
  };
  return (CATALOG[match.capability] ?? [])
    .filter((item) => match.platform === "any" || item.platform === "any" || item.platform === match.platform)
    .map((item, index) => ({
      id: `${item.agentId}-${index}`,
      goal: item.goal,
      agentId: item.agentId,
      capability: match.capability,
      type: item.type,
      payload,
      parallelGroup: 1,
    }));
}
