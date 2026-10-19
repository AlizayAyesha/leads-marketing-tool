import { spawnSync } from "node:child_process";

export const AGENT_REACH_ADAPTER_ID = "agent-reach";
export const AGENT_REACH_ADAPTER_VERSION = "1.0.0";

export type AgentReachLinkedInCapability = {
  cliInstalled: boolean;
  mcporterInstalled: boolean;
  uvxInstalled: boolean;
  search: boolean;
  profileResearch: boolean;
  companyResearch: boolean;
  jobResearch: boolean;
  authenticatedActions: boolean;
  connectionRequests: boolean;
  messages: boolean;
  sendAvailable: boolean;
  zeroConfigBackend: "jina-reader";
  configuredBackend: "mcp-server-linkedin" | null;
  note: string;
};

function hasBinary(name: string) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

export function inspectAgentReachLinkedInCapabilities(
  binaries: { cli?: boolean; mcporter?: boolean; uvx?: boolean } = {},
): AgentReachLinkedInCapability {
  const cliInstalled = binaries.cli ?? hasBinary("agent-reach");
  const mcporterInstalled = binaries.mcporter ?? hasBinary("mcporter");
  const uvxInstalled = binaries.uvx ?? hasBinary("uvx");
  const mcpReady = mcporterInstalled && uvxInstalled;
  return {
    cliInstalled,
    mcporterInstalled,
    uvxInstalled,
    search: mcpReady,
    profileResearch: mcpReady,
    companyResearch: mcpReady,
    jobResearch: mcpReady,
    authenticatedActions: false,
    connectionRequests: false,
    messages: false,
    sendAvailable: false,
    zeroConfigBackend: "jina-reader",
    configuredBackend: mcpReady ? "mcp-server-linkedin" : null,
    note: mcpReady
      ? "Agent-Reach documents LinkedIn research via mcp-server-linkedin (profile/company/jobs/people search). Connection requests and messages use the authenticated Jarvis Chrome session, not Agent-Reach."
      : "Agent-Reach zero-config LinkedIn is Jina Reader of public pages. A LinkedIn login wall is not profile evidence. Account actions use the authenticated Jarvis Chrome session.",
  };
}

export function isAgentReachResearchSelected(name = (process.env.LINKEDIN_RESEARCH_PROVIDER ?? "").trim().toLowerCase()) {
  return name === "agent-reach" || name === "agentreach";
}
