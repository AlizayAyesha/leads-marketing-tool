import type { InstagramResearchResult, InstagramResearchStatus } from "@/lib/instagram/types";

export class InstagramResearchError extends Error {
  readonly status: InstagramResearchStatus;
  readonly code: string;

  constructor(status: InstagramResearchStatus, code: string, message: string) {
    super(message);
    this.name = "InstagramResearchError";
    this.status = status;
    this.code = code;
  }
}

export interface InstagramResearchProvider {
  readonly id: string;
  readonly version: string;
  readonly configured: boolean;
  fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<InstagramResearchResult>;
}
