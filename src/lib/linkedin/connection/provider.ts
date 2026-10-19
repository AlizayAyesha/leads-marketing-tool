import type { LinkedInConnectionProviderResult } from "@/lib/linkedin/connection/types";

export class LinkedInConnectionStatusError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LinkedInConnectionStatusError";
    this.code = code;
  }
}

export type LinkedInConnectionStatusLookup = {
  profileUrl: string;
  normalizedUrl: string;
};

export type LinkedInConnectionStatusResult = {
  result: LinkedInConnectionProviderResult;
  code: string;
  retrievedAt: string;
  source: string;
  message?: string;
};

export interface LinkedInConnectionStatusProvider {
  readonly id: string;
  readonly version: string;
  readonly configured: boolean;
  fetchStatus(input: LinkedInConnectionStatusLookup): Promise<LinkedInConnectionStatusResult>;
}
