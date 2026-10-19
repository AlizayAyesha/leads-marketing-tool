import {
  LINKEDIN_ADAPTER_ID,
  LINKEDIN_ADAPTER_VERSION,
  LINKEDIN_RESEARCH_UNAVAILABLE,
  type LinkedInResearchResult,
} from "@/lib/linkedin/types";
import type { LinkedInResearchProvider } from "@/lib/linkedin/provider";

export class UnavailableLinkedInProvider implements LinkedInResearchProvider {
  readonly id = LINKEDIN_ADAPTER_ID;
  readonly version = LINKEDIN_ADAPTER_VERSION;
  readonly configured = false;

  async fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<LinkedInResearchResult> {
    return {
      status: "UNAVAILABLE",
      code: LINKEDIN_RESEARCH_UNAVAILABLE,
      profile: null,
      evidence: [],
      sourceUrl: input.normalizedUrl || input.profileUrl,
      retrievedAt: new Date().toISOString(),
      adapter: this.id,
      adapterVersion: this.version,
      message:
        "No authorized LinkedIn research source is configured. Connect Jarvis Chrome and sign into LinkedIn, or use Agent-Reach. PDL is optional.",
    };
  }
}
