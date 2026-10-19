import "server-only";

import { getApifyToken } from "@/lib/secrets";
import { redactSecrets } from "@/lib/apify/redact";
import {
  encodeActorId,
  FULL_RESULT_CAP,
  type ApifyRunInfo,
} from "@/lib/apify/ids";

export {
  encodeActorId,
  mapApifyStatus,
  applyResultCap,
  testModeBlockedBySchema,
  TEST_RESULT_CAP,
  FULL_RESULT_CAP,
} from "@/lib/apify/ids";
export type { ApifyRunInfo } from "@/lib/apify/ids";

const APIFY_API = "https://api.apify.com/v2";

export class ApifyNotConfiguredError extends Error {
  constructor() {
    super("Apify is not connected. Set APIFY_TOKEN or save a token in Integrations → API Keys.");
    this.name = "ApifyNotConfiguredError";
  }
}

export type ApifyAccount = {
  username: string | null;
  email: string | null;
  plan: string | null;
};

export type ApifyActorMeta = {
  id: string;
  name: string;
  username: string | null;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
};

export class ApifyService {
  private async token() {
    const resolved = await getApifyToken();
    if (!resolved.token) throw new ApifyNotConfiguredError();
    return resolved.token;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    const response = await fetch(`${APIFY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: { message: text.slice(0, 200) } };
    }
    if (!response.ok) {
      const message =
        (body as { error?: { message?: string } })?.error?.message ||
        `Apify request failed (${response.status})`;
      throw new Error(redactSecrets(message, [token]));
    }
    return body as T;
  }

  async validateConnection() {
    const user = await this.getAccount();
    return { ok: true as const, account: user };
  }

  async getAccount(): Promise<ApifyAccount> {
    const payload = await this.request<{
      data?: { username?: string; email?: string; plan?: { id?: string } };
    }>("/users/me");
    const data = payload.data ?? {};
    return {
      username: data.username ?? null,
      email: data.email ?? null,
      plan: data.plan?.id ?? null,
    };
  }

  async getUsage() {
    try {
      const payload = await this.request<{ data?: unknown }>("/users/me/usage/monthly");
      return payload.data ?? null;
    } catch {
      return null;
    }
  }

  async getActorMeta(actorId: string): Promise<ApifyActorMeta> {
    const encoded = encodeActorId(actorId);
    const payload = await this.request<{
      data?: {
        id?: string;
        name?: string;
        username?: string;
        title?: string;
        description?: string;
      };
    }>(`/acts/${encoded}`);
    const data = payload.data ?? {};
    let inputSchema: Record<string, unknown> | null = null;
    try {
      const build = await this.request<{
        data?: { inputSchema?: string | Record<string, unknown> };
      }>(`/acts/${encoded}/builds/default`);
      const raw = build.data?.inputSchema;
      if (typeof raw === "string") inputSchema = JSON.parse(raw) as Record<string, unknown>;
      else if (raw && typeof raw === "object") inputSchema = raw;
    } catch {
      inputSchema = null;
    }
    return {
      id: data.id ?? encoded,
      name: data.name ?? actorId,
      username: data.username ?? null,
      title: data.title ?? data.name ?? actorId,
      description: data.description ?? null,
      inputSchema,
    };
  }

  async startRun(input: {
    actorId: string;
    runInput: Record<string, unknown>;
    testMode?: boolean;
    waitForFinishSec?: number;
  }): Promise<ApifyRunInfo> {
    const encoded = encodeActorId(input.actorId);
    const wait = input.waitForFinishSec ?? (input.testMode ? 55 : 0);
    const memory = 2048;
    const timeout = input.testMode ? 180 : 3600;
    const query = new URLSearchParams({
      timeout: String(timeout),
      memory: String(memory),
    });
    if (wait > 0) query.set("waitForFinish", String(Math.min(wait, 60)));
    const payload = await this.request<{ data?: Record<string, unknown> }>(
      `/acts/${encoded}/runs?${query.toString()}`,
      { method: "POST", body: JSON.stringify(input.runInput) },
    );
    return mapRun(payload.data ?? {});
  }

  async getRun(runId: string): Promise<ApifyRunInfo> {
    if (!/^[a-zA-Z0-9]+$/.test(runId)) throw new Error("Invalid Apify run ID.");
    const payload = await this.request<{ data?: Record<string, unknown> }>(
      `/actor-runs/${runId}`,
    );
    return mapRun(payload.data ?? {});
  }

  async getDatasetItems(datasetId: string, limit: number) {
    if (!/^[a-zA-Z0-9]+$/.test(datasetId)) throw new Error("Invalid dataset ID.");
    const safeLimit = Math.min(Math.max(limit, 1), FULL_RESULT_CAP);
    const payload = await this.request<unknown[]>(
      `/datasets/${datasetId}/items?limit=${safeLimit}&clean=true`,
    );
    return Array.isArray(payload) ? payload : [];
  }
}

function mapRun(data: Record<string, unknown>): ApifyRunInfo {
  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? "UNKNOWN"),
    defaultDatasetId: data.defaultDatasetId ? String(data.defaultDatasetId) : null,
    startedAt: data.startedAt ? String(data.startedAt) : null,
    finishedAt: data.finishedAt ? String(data.finishedAt) : null,
    statusMessage: data.statusMessage ? String(data.statusMessage) : null,
  };
}

