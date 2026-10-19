import {
  type LinkedInConnectionStatusLookup,
  type LinkedInConnectionStatusProvider,
  type LinkedInConnectionStatusResult,
} from "@/lib/linkedin/connection/provider";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { captureLinkedInEvidence, CHROME_LINKEDIN_PROVIDER_ID } from "@/lib/linkedin/session/actions";
import { chromeLinkedInSessionHost, isChromeLinkedInSessionReady, type LinkedInSessionHost } from "@/lib/linkedin/session/host";
import { inspectLinkedInPage, mapUiStateToProviderResult } from "@/lib/linkedin/session/inspect";

export class ChromeLinkedInConnectionStatusProvider implements LinkedInConnectionStatusProvider {
  readonly id = CHROME_LINKEDIN_PROVIDER_ID;
  readonly version = "1.0.0";

  constructor(private readonly host: LinkedInSessionHost = chromeLinkedInSessionHost()) {}

  get configured() {
    return this.host.connected();
  }

  async fetchStatus(input: LinkedInConnectionStatusLookup): Promise<LinkedInConnectionStatusResult> {
    if (!this.host.connected()) {
      return {
        result: "UNKNOWN",
        code: "LINKEDIN_CONNECTION_STATUS_UNAVAILABLE",
        retrievedAt: new Date().toISOString(),
        source: input.normalizedUrl || input.profileUrl,
        message: "Jarvis Chrome is disconnected. UNKNOWN is not CONNECTED.",
      };
    }
    const inspectedUrl = inspectLinkedInUrl(input.normalizedUrl || input.profileUrl);
    if (inspectedUrl.kind !== "person" || !inspectedUrl.normalizedUrl) {
      return {
        result: "UNKNOWN",
        code: "NOT_PERSON_URL",
        retrievedAt: new Date().toISOString(),
        source: input.normalizedUrl || input.profileUrl,
        message: "Connection status checks need a person LinkedIn URL. UNKNOWN is not CONNECTED.",
      };
    }
    try {
      return await this.host.runOnPage(async (page) => {
        await page.goto(inspectedUrl.normalizedUrl!);
        const inspected = await inspectLinkedInPage(page);
        const evidence = await captureLinkedInEvidence({
          page,
          leadId: "status",
          profileUrl: inspectedUrl.normalizedUrl!,
          action: "status",
          inspected,
        });
        return {
          result: mapUiStateToProviderResult(inspected.state),
          code: inspected.code,
          retrievedAt: evidence.at,
          source: evidence.url || inspectedUrl.normalizedUrl!,
          message: inspected.reason,
        };
      });
    } catch (error) {
      return {
        result: "UNKNOWN",
        code: "SESSION_ERROR",
        retrievedAt: new Date().toISOString(),
        source: inspectedUrl.normalizedUrl,
        message:
          error instanceof Error
            ? error.message
            : "LinkedIn Chrome status check failed. UNKNOWN is not CONNECTED.",
      };
    }
  }
}

export function chromeLinkedInStatusIfReady(): LinkedInConnectionStatusProvider | null {
  if (!isChromeLinkedInSessionReady()) return null;
  return new ChromeLinkedInConnectionStatusProvider();
}
