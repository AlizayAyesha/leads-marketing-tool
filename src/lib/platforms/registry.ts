import "server-only";

import { FiverrAgent } from "@/lib/platforms/fiverr/agent";
import { FiverrFollowUpAgent } from "@/lib/platforms/fiverr/follow-up";
import { FiverrIntelligenceAgent } from "@/lib/platforms/fiverr/intelligence";
import { FiverrGigOptimizerAgent } from "@/lib/platforms/fiverr/optimizer";
import { FiverrQualificationAgent } from "@/lib/platforms/fiverr/qualify-agent";
import { FiverrResponseAgent } from "@/lib/platforms/fiverr/response";
import { withPlatformRunLogging } from "@/lib/platforms/run-log";
import { UpworkAgent } from "@/lib/platforms/upwork/agent";
import { UpworkProposalAgent } from "@/lib/platforms/upwork/proposal";
import { UpworkQualificationAgent } from "@/lib/platforms/upwork/qualify";
import type { Capability } from "@/lib/brain/capabilities";
import type { PlatformAgent } from "@/lib/platforms/types";

const agents: PlatformAgent[] = [
  new UpworkAgent(),
  new UpworkQualificationAgent(),
  new UpworkProposalAgent(),
  new FiverrAgent(),
  new FiverrIntelligenceAgent(),
  new FiverrGigOptimizerAgent(),
  new FiverrQualificationAgent(),
  new FiverrResponseAgent(),
  new FiverrFollowUpAgent(),
].map(withPlatformRunLogging);

export function listPlatformAgents() {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    platform: agent.platform,
    capabilities: agent.capabilities,
    permissions: agent.permissions,
  }));
}

export function agentsForCapability(capability: Capability, platform?: string) {
  return agents.filter((agent) => {
    const hasCap = (agent.capabilities as readonly string[]).includes(capability);
    if (!hasCap) return false;
    if (!platform || platform === "any") return true;
    return agent.platform === platform;
  });
}

export function getPlatformAgent(id: string) {
  const agent = agents.find((item) => item.id === id);
  if (!agent) throw new Error(`Unknown platform agent: ${id}`);
  return agent;
}
