import "server-only";

import { BrowserAgent } from "@/lib/agents/browser";
import { FollowUpAgent } from "@/lib/agents/follow-up";
import { IntakeAgent } from "@/lib/agents/intake";
import { InstagramResearchAgent } from "@/lib/agents/instagram-research";
import { LinkedInResearchAgent } from "@/lib/agents/linkedin-research";
import { OpportunityAgent } from "@/lib/agents/opportunity";
import { OutreachWriterAgent } from "@/lib/agents/outreach-writer";
import { DecisionMakerAgent } from "@/lib/agents/decision-maker";
import { SignalAgent } from "@/lib/agents/signals";
import { QualificationAgent } from "@/lib/agents/qualification";
import { ResearchAgent } from "@/lib/agents/research";
import { StrategistAgent } from "@/lib/agents/strategist";
import type { SpecializedAgent } from "@/lib/agents/types";

const agents: SpecializedAgent[] = [
  new IntakeAgent(),
  new ResearchAgent(),
  new LinkedInResearchAgent(),
  new InstagramResearchAgent(),
  new SignalAgent(),
  new QualificationAgent(),
  new DecisionMakerAgent(),
  new OpportunityAgent(),
  new StrategistAgent(),
  new OutreachWriterAgent(),
  new FollowUpAgent(),
  new BrowserAgent(),
];

export function getAgent(slug: string) {
  const agent = agents.find((item) => item.slug === slug);
  if (!agent) throw new Error(`Unknown agent: ${slug}`);
  return agent;
}

export function listAgents() {
  return agents.map((agent) => ({
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
  }));
}
