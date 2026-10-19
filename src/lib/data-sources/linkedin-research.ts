import type { DataSourceAdapter, DataSourceResult } from "@/lib/data-sources/types";
import type { LinkedInResearchProvider } from "@/lib/linkedin/provider";
import { getLinkedInResearchProvider } from "@/lib/linkedin/registry";
import { queryLinkedInResearch } from "@/lib/linkedin/query";
import { LINKEDIN_ADAPTER_ID, LINKEDIN_RESEARCH_UNAVAILABLE, type LinkedInResearchResult } from "@/lib/linkedin/types";

export type LinkedInResearchInput = {
  profileUrl?: string | null;
};

export class LinkedInResearchAdapter implements DataSourceAdapter<LinkedInResearchInput, LinkedInResearchResult> {
  readonly id = LINKEDIN_ADAPTER_ID;
  readonly phase = 3 as const;
  readonly provider: LinkedInResearchProvider;

  constructor(provider: LinkedInResearchProvider = getLinkedInResearchProvider()) {
    this.provider = provider;
  }

  get configured() {
    return this.provider.configured;
  }

  async acquire(input: LinkedInResearchInput): Promise<DataSourceResult<LinkedInResearchResult>> {
    const { resolveLinkedInResearchProvider } = await import("@/lib/linkedin/registry");
    const provider = this.provider.configured ? this.provider : await resolveLinkedInResearchProvider();
    const data = await queryLinkedInResearch({ profileUrl: input.profileUrl, provider });
    return {
      adapter: this.id,
      data,
      sourceUrls: data.sourceUrl ? [data.sourceUrl] : [],
      pending: data.status === "UNAVAILABLE",
      message: data.message ?? (data.status === "UNAVAILABLE" ? LINKEDIN_RESEARCH_UNAVAILABLE : undefined),
    };
  }
}
