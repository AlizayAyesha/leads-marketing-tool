import { CHROME_LINKEDIN_PROVIDER_ID, executeLinkedInSend } from "@/lib/linkedin/session/actions";
import { chromeLinkedInSessionHost, isChromeLinkedInSessionReady, type LinkedInSessionHost } from "@/lib/linkedin/session/host";
import {
  LINKEDIN_SEND_UNAVAILABLE,
  LINKEDIN_SEND_UNAVAILABLE_REASON,
  type LinkedInSendProvider,
  type LinkedInSendRequest,
  type LinkedInSendResult,
} from "@/lib/linkedin/send/types";

export class ChromeLinkedInSendProvider implements LinkedInSendProvider {
  readonly id = CHROME_LINKEDIN_PROVIDER_ID;

  constructor(private readonly host: LinkedInSessionHost = chromeLinkedInSessionHost()) {}

  get configured() {
    return this.host.connected();
  }

  async send(request: LinkedInSendRequest): Promise<LinkedInSendResult> {
    if (!this.host.connected()) {
      return {
        ok: false,
        sent: false,
        code: LINKEDIN_SEND_UNAVAILABLE,
        reason: LINKEDIN_SEND_UNAVAILABLE_REASON,
        provider: this.id,
        externalId: null,
      };
    }
    try {
      return await this.host.runOnPage((page) => executeLinkedInSend(page, request));
    } catch (error) {
      return {
        ok: false,
        sent: false,
        code: "SESSION_ERROR",
        reason: error instanceof Error ? error.message : "LinkedIn Chrome session failed. Nothing was recorded as sent.",
        provider: this.id,
        externalId: null,
      };
    }
  }
}

export function chromeLinkedInSendIfReady(): LinkedInSendProvider | null {
  if (!isChromeLinkedInSessionReady()) return null;
  return new ChromeLinkedInSendProvider();
}
