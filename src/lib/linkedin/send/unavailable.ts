import {
  LINKEDIN_SEND_UNAVAILABLE,
  LINKEDIN_SEND_UNAVAILABLE_REASON,
  type LinkedInSendProvider,
  type LinkedInSendRequest,
  type LinkedInSendResult,
} from "@/lib/linkedin/send/types";

export class UnavailableLinkedInSendProvider implements LinkedInSendProvider {
  readonly id = "unavailable";
  readonly configured = false;

  async send(_request: LinkedInSendRequest): Promise<LinkedInSendResult> {
    return {
      ok: false,
      sent: false,
      code: LINKEDIN_SEND_UNAVAILABLE,
      reason: LINKEDIN_SEND_UNAVAILABLE_REASON,
      provider: this.id,
      externalId: null,
    };
  }
}
