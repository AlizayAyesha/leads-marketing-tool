import { isAgentReachResearchSelected } from "@/lib/agent-reach/capabilities";
import { AgentReachLinkedInProvider } from "@/lib/linkedin/agent-reach-provider";
import type { LinkedInResearchProvider } from "@/lib/linkedin/provider";
import { PdlLinkedInProvider } from "@/lib/linkedin/pdl-provider";
import { UnavailableLinkedInProvider } from "@/lib/linkedin/unavailable-provider";
import { chromeLinkedInResearchIfReady } from "@/lib/linkedin/session/chrome-research";

let testOverride: LinkedInResearchProvider | null = null;

export function setLinkedInResearchProviderForTests(provider: LinkedInResearchProvider | null) {
  testOverride = provider;
}

function providerName() {
  return (process.env.LINKEDIN_RESEARCH_PROVIDER ?? "").trim().toLowerCase();
}

export function shouldUseAgentReachLinkedInProvider(name = providerName()) {
  if (name === "none" || name === "unavailable") return false;
  if (name === "pdl" || name === "peopledatalabs") return false;
  return isAgentReachResearchSelected(name);
}

export function shouldUsePdlLinkedInProvider(name = providerName(), hasKey = Boolean(process.env.PDL_API_KEY?.trim())) {
  if (name === "none" || name === "unavailable") return false;
  if (isAgentReachResearchSelected(name)) return false;
  if (name === "pdl" || name === "peopledatalabs") return true;
  return !name && hasKey;
}

export function getLinkedInResearchProvider(): LinkedInResearchProvider {
  if (testOverride) return testOverride;
  const chrome = chromeLinkedInResearchIfReady();
  if (chrome) return chrome;
  if (shouldUseAgentReachLinkedInProvider()) {
    return new AgentReachLinkedInProvider({ configured: true });
  }
  if (shouldUsePdlLinkedInProvider()) {
    return new PdlLinkedInProvider({
      getApiKey: async () => process.env.PDL_API_KEY?.trim() || null,
    });
  }
  return new UnavailableLinkedInProvider();
}

export async function resolveLinkedInResearchProvider(): Promise<LinkedInResearchProvider> {
  if (testOverride) return testOverride;
  const chrome = chromeLinkedInResearchIfReady();
  if (chrome) return chrome;
  if (shouldUseAgentReachLinkedInProvider()) {
    return new AgentReachLinkedInProvider({ configured: true });
  }
  const { getPdlApiKey } = await import("@/lib/pdl/secrets");
  const key = await getPdlApiKey();
  if (shouldUsePdlLinkedInProvider(providerName(), Boolean(key.token))) {
    return new PdlLinkedInProvider({
      getApiKey: async () => (await getPdlApiKey()).token,
    });
  }
  return new UnavailableLinkedInProvider();
}
