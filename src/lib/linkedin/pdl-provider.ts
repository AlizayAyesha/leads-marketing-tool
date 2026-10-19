import { LinkedInResearchError, type LinkedInResearchProvider } from "@/lib/linkedin/provider";
import type { LinkedInResearchResult } from "@/lib/linkedin/types";
import { PdlClient, PdlClientError, pdlStatusCode } from "@/lib/pdl/client";
import { PDL_ADAPTER_ID, PDL_ADAPTER_VERSION, PDL_MIN_LIKELIHOOD } from "@/lib/pdl/constants";
import { pdlPersonToResearchResult } from "@/lib/pdl/map-person";
import type { PdlEnrichResponse } from "@/lib/pdl/types";

export type PdlLinkedInProviderDeps = {
  getApiKey: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export class PdlLinkedInProvider implements LinkedInResearchProvider {
  readonly id = PDL_ADAPTER_ID;
  readonly version = PDL_ADAPTER_VERSION;

  constructor(private readonly deps: PdlLinkedInProviderDeps) {}

  get configured() {
    return true;
  }

  async fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<LinkedInResearchResult> {
    const apiKey = await this.deps.getApiKey();
    if (!apiKey) {
      throw new LinkedInResearchError(
        "AUTH_REQUIRED",
        "PDL_API_KEY_MISSING",
        "People Data Labs is selected, but no API key is configured.",
      );
    }

    const client = new PdlClient(apiKey, { fetchImpl: this.deps.fetchImpl });
    try {
      const result = await client.enrichPerson({
        profile: input.normalizedUrl || input.profileUrl,
        min_likelihood: PDL_MIN_LIKELIHOOD,
      });
      return mapEnrichResponse(result.httpStatus, result.body, input.normalizedUrl || input.profileUrl);
    } catch (error) {
      if (error instanceof PdlClientError && error.code === "TIMEOUT") {
        throw new LinkedInResearchError("TIMEOUT", "TIMEOUT", error.message);
      }
      throw error;
    }
  }
}

export function mapEnrichResponse(
  httpStatus: number,
  body: PdlEnrichResponse | null,
  requestedUrl: string,
): LinkedInResearchResult {
  const status = pdlStatusCode(httpStatus, body?.status);
  if (status === 401 || status === 403) {
    throw new LinkedInResearchError("AUTH_REQUIRED", "AUTH_REQUIRED", "People Data Labs rejected the API key.");
  }
  if (status === 429) {
    throw new LinkedInResearchError("RATE_LIMITED", "RATE_LIMITED", "People Data Labs rate limit reached.");
  }
  if (status === 402) {
    throw new LinkedInResearchError(
      "ERROR",
      "PDL_PAYMENT_REQUIRED",
      "People Data Labs credits are exhausted.",
    );
  }
  if (status === 404) {
    return {
      status: "UNAVAILABLE",
      code: "PDL_NOT_FOUND",
      profile: null,
      evidence: [],
      sourceUrl: requestedUrl,
      retrievedAt: new Date().toISOString(),
      adapter: PDL_ADAPTER_ID,
      adapterVersion: PDL_ADAPTER_VERSION,
      message: "People Data Labs found no licensed person match for this LinkedIn URL.",
    };
  }
  if (status !== 200 || !body?.data) {
    throw new LinkedInResearchError(
      "ERROR",
      "PDL_ERROR",
      body?.error?.message || `People Data Labs enrichment failed (${status || "unknown"}).`,
    );
  }
  return pdlPersonToResearchResult({
    person: body.data,
    requestedUrl,
    likelihood: body.likelihood,
  });
}
