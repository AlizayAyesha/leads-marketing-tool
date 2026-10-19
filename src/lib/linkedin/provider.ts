import type { LinkedInResearchResult, LinkedInResearchStatus } from "@/lib/linkedin/types";

export class LinkedInResearchError extends Error {
  readonly status: LinkedInResearchStatus;
  readonly code: string;

  constructor(status: LinkedInResearchStatus, code: string, message: string) {
    super(message);
    this.name = "LinkedInResearchError";
    this.status = status;
    this.code = code;
  }
}

export interface LinkedInResearchProvider {
  readonly id: string;
  readonly version: string;
  readonly configured: boolean;
  fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<LinkedInResearchResult>;
}
