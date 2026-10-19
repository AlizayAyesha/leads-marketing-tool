import type { LinkedInConnectionStatusProvider, LinkedInConnectionStatusResult } from "@/lib/linkedin/connection/provider";

export const LINKEDIN_CONNECTION_STATUS_UNAVAILABLE = "LINKEDIN_CONNECTION_STATUS_UNAVAILABLE";

export class UnavailableLinkedInConnectionStatusProvider implements LinkedInConnectionStatusProvider {
  readonly id = "linkedin-connection-status";
  readonly version = "1.0.0";
  readonly configured = false;

  async fetchStatus(input: { profileUrl: string; normalizedUrl: string }): Promise<LinkedInConnectionStatusResult> {
    return {
      result: "UNKNOWN",
      code: LINKEDIN_CONNECTION_STATUS_UNAVAILABLE,
      retrievedAt: new Date().toISOString(),
      source: input.normalizedUrl || input.profileUrl,
        message:
          "No authorized LinkedIn connection-status source is configured. Connect Jarvis Chrome with a signed-in LinkedIn session. Jarvis will not treat REQUESTED as CONNECTED.",
    };
  }
}
