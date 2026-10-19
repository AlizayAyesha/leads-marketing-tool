import {
  INSTAGRAM_ADAPTER_ID,
  INSTAGRAM_ADAPTER_VERSION,
  INSTAGRAM_RESEARCH_UNAVAILABLE,
  type InstagramResearchResult,
} from "@/lib/instagram/types";
import type { InstagramResearchProvider } from "@/lib/instagram/provider";

export class UnavailableInstagramProvider implements InstagramResearchProvider {
  readonly id = INSTAGRAM_ADAPTER_ID;
  readonly version = INSTAGRAM_ADAPTER_VERSION;
  readonly configured = false;

  async fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<InstagramResearchResult> {
    return {
      status: "UNAVAILABLE",
      code: INSTAGRAM_RESEARCH_UNAVAILABLE,
      profile: null,
      evidence: [],
      sourceUrl: input.normalizedUrl || input.profileUrl,
      retrievedAt: new Date().toISOString(),
      adapter: this.id,
      adapterVersion: this.version,
      message:
        "No authorized Instagram research source is configured. Jarvis will not scrape Instagram, send DMs, or use a Chrome login as a workaround.",
    };
  }
}
