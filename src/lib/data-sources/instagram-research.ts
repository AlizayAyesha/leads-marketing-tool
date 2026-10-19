import type { DataSourceAdapter, DataSourceResult } from "@/lib/data-sources/types";
import type { InstagramResearchProvider } from "@/lib/instagram/provider";
import { getInstagramResearchProvider } from "@/lib/instagram/registry";
import { queryInstagramResearch } from "@/lib/instagram/query";
import { INSTAGRAM_ADAPTER_ID, INSTAGRAM_RESEARCH_UNAVAILABLE, type InstagramResearchResult } from "@/lib/instagram/types";

export type InstagramResearchInput = {
  profileUrl?: string | null;
};

export class InstagramResearchAdapter implements DataSourceAdapter<InstagramResearchInput, InstagramResearchResult> {
  readonly id = INSTAGRAM_ADAPTER_ID;
  readonly phase = 3 as const;
  readonly provider: InstagramResearchProvider;

  constructor(provider: InstagramResearchProvider = getInstagramResearchProvider()) {
    this.provider = provider;
  }

  get configured() {
    return this.provider.configured;
  }

  async acquire(input: InstagramResearchInput): Promise<DataSourceResult<InstagramResearchResult>> {
    const data = await queryInstagramResearch({ profileUrl: input.profileUrl, provider: this.provider });
    return {
      adapter: this.id,
      data,
      sourceUrls: data.sourceUrl ? [data.sourceUrl] : [],
      pending: data.status === "UNAVAILABLE",
      message: data.message ?? (data.status === "UNAVAILABLE" ? INSTAGRAM_RESEARCH_UNAVAILABLE : undefined),
    };
  }
}
