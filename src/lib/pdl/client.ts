import {
  PDL_ENRICH_URL,
  PDL_MIN_LIKELIHOOD,
  PDL_REQUEST_TIMEOUT_MS,
  PDL_SEARCH_URL,
} from "@/lib/pdl/constants";
import type { PdlEnrichParams, PdlEnrichResponse, PdlHttpResult, PdlSearchResponse } from "@/lib/pdl/types";

export class PdlClientError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = "PdlClientError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export type PdlClientDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function retryAfterMs(headers: Headers) {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export class PdlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    deps: PdlClientDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? PDL_REQUEST_TIMEOUT_MS;
  }

  async enrichPerson(params: PdlEnrichParams): Promise<PdlHttpResult<PdlEnrichResponse>> {
    const url = new URL(PDL_ENRICH_URL);
    const minLikelihood = params.min_likelihood ?? PDL_MIN_LIKELIHOOD;
    url.searchParams.set("min_likelihood", String(minLikelihood));
    if (params.required) url.searchParams.set("required", params.required);
    if (params.profile) url.searchParams.set("profile", params.profile);
    if (params.email) url.searchParams.set("email", params.email);
    if (params.name) url.searchParams.set("name", params.name);
    if (params.first_name) url.searchParams.set("first_name", params.first_name);
    if (params.last_name) url.searchParams.set("last_name", params.last_name);
    if (params.company) url.searchParams.set("company", params.company);
    if (params.location) url.searchParams.set("location", params.location);
    if (params.phone) url.searchParams.set("phone", params.phone);

    return this.request<PdlEnrichResponse>(url.toString(), { method: "GET" });
  }

  async searchPeople(input: { sql: string; size: number }): Promise<PdlHttpResult<PdlSearchResponse>> {
    return this.request<PdlSearchResponse>(PDL_SEARCH_URL, {
      method: "POST",
      body: JSON.stringify({
        sql: input.sql,
        size: input.size,
        dataset: "resume",
      }),
    });
  }

  private async request<T>(url: string, init: { method: string; body?: string }): Promise<PdlHttpResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: init.method,
        signal: controller.signal,
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body,
      });
      const body = (await readJson(response)) as T | null;
      return {
        httpStatus: response.status,
        body,
        retryAfterMs: retryAfterMs(response.headers),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new PdlClientError(0, "TIMEOUT", "People Data Labs request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function pdlStatusCode(httpStatus: number, bodyStatus?: number) {
  return bodyStatus && bodyStatus > 0 ? bodyStatus : httpStatus;
}
