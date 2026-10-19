import type { ZarService } from "@prisma/client";

import type { DetectedOpportunity } from "@/lib/intelligence/opportunity";

export type SolutionRecord = {
  slug: string;
  name: string;
  family: "digital" | "software" | "ai";
  zarService: ZarService;
  needles: string[];
};

export const DEFAULT_SOLUTIONS: SolutionRecord[] = [
  { slug: "landing_pages", name: "Landing pages", family: "digital", zarService: "WEBSITE_DEVELOPMENT", needles: ["landing"] },
  { slug: "websites", name: "Websites", family: "digital", zarService: "WEBSITE_DEVELOPMENT", needles: ["website_modernization", "website"] },
  { slug: "web_applications", name: "Web applications", family: "digital", zarService: "FULL_STACK_DEVELOPMENT", needles: ["web_application", "web app"] },
  { slug: "dashboards", name: "Dashboards", family: "digital", zarService: "SAAS_DEVELOPMENT", needles: ["dashboard"] },
  { slug: "custom_software", name: "Custom software", family: "software", zarService: "CUSTOM_SOFTWARE", needles: ["custom_software", "custom software"] },
  { slug: "saas", name: "SaaS", family: "software", zarService: "SAAS_DEVELOPMENT", needles: ["saas"] },
  { slug: "internal_platforms", name: "Internal business platforms", family: "software", zarService: "CRM_ERP_DEVELOPMENT", needles: ["internal_platforms", "crm", "erp"] },
  { slug: "integrations", name: "Integrations", family: "software", zarService: "AI_INTEGRATION", needles: ["integrat", "api"] },
  { slug: "enterprise_systems", name: "Enterprise systems", family: "software", zarService: "CUSTOM_SOFTWARE", needles: ["enterprise"] },
  { slug: "ai_automation", name: "AI automation", family: "ai", zarService: "AI_AUTOMATION", needles: ["workflow_automation"] },
  { slug: "ai_agents", name: "AI agents", family: "ai", zarService: "AI_AUTOMATION", needles: ["ai_agents", "ai agent"] },
  { slug: "ai_employees", name: "AI employees", family: "ai", zarService: "AI_AUTOMATION", needles: ["ai employee"] },
  { slug: "agentic_workflows", name: "Agentic workflows", family: "ai", zarService: "AI_AUTOMATION", needles: ["agentic_workflow", "agentic"] },
  { slug: "multi_agent_systems", name: "Multi-agent systems", family: "ai", zarService: "AI_AUTOMATION", needles: ["multi-agent"] },
];

export type SolutionMatch = {
  slug: string;
  name: string;
  zarService: ZarService;
  reason: string;
  forced: false;
};

export function matchSolution(
  opportunity: DetectedOpportunity,
  catalog: SolutionRecord[] = DEFAULT_SOLUTIONS,
): SolutionMatch | null {
  if (opportunity.opportunityKey === "unknown" || opportunity.confidence === "UNKNOWN") return null;

  const key = opportunity.opportunityKey.toLowerCase();
  const exact = catalog.find(
    (item) => item.slug === key || item.needles.some((needle) => needle.toLowerCase() === key),
  );
  if (exact) return toMatch(exact, opportunity.opportunityKey);

  const hay = `${opportunity.opportunityKey} ${opportunity.opportunity}`.toLowerCase();
  let best: { item: SolutionRecord; length: number } | null = null;
  for (const item of catalog) {
    if (item.slug === "ai_agents" && key !== "ai_agents") continue;
    for (const needle of item.needles) {
      if (!hay.includes(needle.toLowerCase())) continue;
      if (!best || needle.length > best.length) best = { item, length: needle.length };
    }
  }
  if (!best) return null;
  return toMatch(best.item, opportunity.opportunityKey);
}

function toMatch(item: SolutionRecord, opportunityKey: string): SolutionMatch {
  return {
    slug: item.slug,
    name: item.name,
    zarService: item.zarService,
    reason: `Matched after opportunity '${opportunityKey}', not by forcing a default service.`,
    forced: false,
  };
}
