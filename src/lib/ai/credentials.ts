import "server-only";

import type OpenAI from "openai";

import { createAIClient } from "@/lib/ai/client";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { getSetting, setSetting, writeAudit } from "@/lib/db/settings";
import { maskOpenAIKey, redactSecrets } from "@/lib/apify/redact";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import {
  classifyOpenAIError,
  isTransientRateLimit,
  marksCredentialUnhealthy,
  retryAfterMs,
  type OpenAIErrorCategory,
} from "@/lib/ai/errors";
import type { CredentialPolicyState, CredentialPublic } from "@/lib/ai/types";
import { AllOpenAICredentialsUnavailableError, runCredentialedOperation } from "@/lib/ai/runtime";

export type { CredentialPolicyState, CredentialPublic } from "@/lib/ai/types";
export { AllOpenAICredentialsUnavailableError } from "@/lib/ai/runtime";

const POLICY_KEY = "openai.credentials.policy";

type ResolvedCredential = {
  id: string;
  name: string;
  apiKey: string;
  source: "env" | "database";
  lastUsedAt: Date | null;
  enabled: boolean;
  status: string;
  cooldownUntil: Date | null;
};

let cachedHasAny = false;

export function openaiCredentialSnapshot() {
  return cachedHasAny || Boolean(getEnv().openaiKey);
}

export async function refreshCredentialCache() {
  if (getEnv().openaiKey) {
    cachedHasAny = true;
    return true;
  }
  try {
    cachedHasAny = (await prisma.aiCredential.count()) > 0;
  } catch {
    // Keep the last known snapshot if Postgres is unreachable.
  }
  return cachedHasAny;
}

export async function getCredentialPolicy(): Promise<CredentialPolicyState> {
  return getSetting<CredentialPolicyState>(POLICY_KEY, {
    policy: "ROUND_ROBIN",
    failover: true,
    roundRobinIndex: 0,
  });
}

export async function saveCredentialPolicy(input: Partial<CredentialPolicyState>) {
  const current = await getCredentialPolicy();
  const next = { ...current, ...input };
  await setSetting(POLICY_KEY, next);
  return next;
}

export async function listPublicCredentials(): Promise<CredentialPublic[]> {
  const env = getEnv();
  const rows = await prisma.aiCredential.findMany({ orderBy: { createdAt: "asc" } }).catch(() => []);
  cachedHasAny = rows.length > 0 || Boolean(env.openaiKey);
  const envRow: CredentialPublic | null = env.openaiKey
    ? {
        id: "env",
        name: "Environment Credential",
        provider: "OPENAI",
        source: "env",
        hint: maskOpenAIKey(env.openaiKey),
        enabled: true,
        status: "CONFIGURED",
        lastTestedAt: null,
        lastUsedAt: null,
        lastErrorAt: null,
        errorCount: 0,
        successCount: 0,
        createdAt: null,
      }
    : null;
  return [
    ...(envRow ? [envRow] : []),
    ...rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: "OPENAI" as const,
      source: "database" as const,
      hint: row.keyHint,
      enabled: row.enabled,
      status: row.status,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
      errorCount: row.errorCount,
      successCount: row.successCount,
      createdAt: row.createdAt.toISOString(),
    })),
  ];
}

async function resolveAll(): Promise<ResolvedCredential[]> {
  const env = getEnv();
  const rows = await prisma.aiCredential.findMany({ orderBy: { createdAt: "asc" } });
  cachedHasAny = rows.length > 0 || Boolean(env.openaiKey);
  const list: ResolvedCredential[] = [];
  if (env.openaiKey) {
    list.push({
      id: "env",
      name: "Environment Credential",
      apiKey: env.openaiKey,
      source: "env",
      lastUsedAt: null,
      enabled: true,
      status: "HEALTHY",
      cooldownUntil: null,
    });
  }
  for (const row of rows) {
    list.push({
      id: row.id,
      name: row.name,
      apiKey: decryptSecret({ ciphertext: row.keyCiphertext, iv: row.keyIv, tag: row.keyTag }),
      source: "database",
      lastUsedAt: row.lastUsedAt,
      enabled: row.enabled,
      status: row.status,
      cooldownUntil: row.cooldownUntil,
    });
  }
  return list;
}

function isEligible(item: ResolvedCredential, now = new Date()) {
  if (!item.enabled) return false;
  if (item.status === "UNHEALTHY" || item.status === "DISABLED") return false;
  if (item.cooldownUntil && item.cooldownUntil > now) return false;
  return true;
}

export async function addOpenAICredential(input: { name: string; apiKey: string }) {
  const name = input.name.trim();
  const apiKey = input.apiKey.trim();
  if (!name) return { error: "Name is required." };
  if (!apiKey.startsWith("sk-")) return { error: "That does not look like an OpenAI API key." };
  const encrypted = encryptSecret(apiKey);
  const row = await prisma.aiCredential.create({
    data: {
      name,
      provider: "OPENAI",
      keyCiphertext: encrypted.ciphertext,
      keyIv: encrypted.iv,
      keyTag: encrypted.tag,
      keyHint: maskOpenAIKey(apiKey) ?? "sk-••••",
    },
  });
  cachedHasAny = true;
  await writeAudit({
    action: "credential_added",
    entity: "ai_credential",
    entityId: row.id,
    actor: "operator",
    payload: { name, provider: "OPENAI" },
  });
  return { id: row.id };
}

export async function setCredentialEnabled(id: string, enabled: boolean) {
  if (id === "env") return { error: "The environment credential is controlled by OPENROUTER_API_KEY / OPENAI_API_KEY." };
  await prisma.aiCredential.update({
    where: { id },
    data: { enabled, status: enabled ? "HEALTHY" : "DISABLED" },
  });
  await writeAudit({
    action: enabled ? "credential_enabled" : "credential_disabled",
    entity: "ai_credential",
    entityId: id,
    actor: "operator",
  });
  return { ok: true };
}

export async function deleteCredential(id: string) {
  if (id === "env") return { error: "Remove OPENROUTER_API_KEY / OPENAI_API_KEY from the environment to drop the env credential." };
  await prisma.aiCredential.delete({ where: { id } });
  await writeAudit({
    action: "credential_deleted",
    entity: "ai_credential",
    entityId: id,
    actor: "operator",
  });
  return { ok: true };
}

export async function migrateEnvCredential(name = "Migrated env key") {
  const env = getEnv();
  if (!env.openaiKey) return { error: "No AI key is set (OPENROUTER_API_KEY or OPENAI_API_KEY)." };
  return addOpenAICredential({ name, apiKey: env.openaiKey });
}

export async function openaiStatusSummary() {
  const credentials = await listPublicCredentials();
  const policy = await getCredentialPolicy();
  const last = await prisma.aiUsageEvent.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null);
  const enabled = credentials.filter((item) => item.enabled);
  const healthy = credentials.filter(
    (item) => item.enabled && (item.status === "HEALTHY" || item.status === "CONFIGURED"),
  );
  const unavailable = credentials.filter(
    (item) => !item.enabled || item.status === "UNHEALTHY" || item.status === "RATE_LIMITED",
  );
  return {
    configured: credentials.length > 0,
    enabled: enabled.length,
    disabled: credentials.filter((item) => !item.enabled).length,
    healthy: healthy.length,
    unavailable: unavailable.length,
    failover: policy.failover,
    policy: policy.policy,
    lastRequestAt: last?.createdAt.toISOString() ?? null,
    lastSuccess: last?.success ?? null,
    lastOperation: last?.operation ?? null,
    lastModel: last?.model ?? null,
  };
}

async function recordUsage(input: {
  credentialId: string;
  model: string;
  operation: string;
  success: boolean;
  errorCategory?: string | null;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}) {
  try {
    await prisma.aiUsageEvent.create({
      data: {
        credentialId: input.credentialId === "env" ? null : input.credentialId,
        credentialRef: input.credentialId,
        model: input.model,
        operation: input.operation,
        success: input.success,
        errorCategory: input.errorCategory ?? null,
        latencyMs: input.latencyMs,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
      },
    });
  } catch {
    // Usage recording must not break the operator-facing request.
  }
}

async function markOutcome(id: string, category: OpenAIErrorCategory | null, success: boolean, error?: unknown) {
  if (id === "env") return;
  if (success) {
    await prisma.aiCredential.update({
      where: { id },
      data: {
        lastUsedAt: new Date(),
        successCount: { increment: 1 },
        status: "HEALTHY",
        cooldownUntil: null,
      },
    });
    return;
  }
  const data: Prisma.AiCredentialUpdateInput = {
    lastErrorAt: new Date(),
    errorCount: { increment: 1 },
  };
  if (category && marksCredentialUnhealthy(category)) {
    data.status = "UNHEALTHY";
  } else if (category && isTransientRateLimit(category)) {
    data.status = "RATE_LIMITED";
    data.cooldownUntil = new Date(Date.now() + retryAfterMs(error));
  }
  await prisma.aiCredential.update({ where: { id }, data });
}

function logOperation(input: {
  credentialId: string;
  credentialName: string;
  operation: string;
  model: string;
  success: boolean;
  duration: number;
  category?: string | null;
}) {
  console.info(
    redactSecrets(
      JSON.stringify({
        credentialId: input.credentialId,
        credentialName: input.credentialName,
        provider: "OPENAI",
        model: input.model,
        operation: input.operation,
        duration: input.duration,
        success: input.success,
        errorClassification: input.category ?? null,
      }),
    ),
  );
}

export async function testCredential(id: string) {
  const all = await resolveAll();
  const cred = all.find((item) => item.id === id);
  if (!cred) {
    return {
      ok: false as const,
      name: id,
      status: "FAILED",
      model: "models.list",
      timestamp: new Date().toISOString(),
      errorCategory: "UNKNOWN",
    };
  }
  const started = Date.now();
  try {
    const client = createAIClient(cred.apiKey, { timeout: 20_000 });
    const models = await client.models.list();
    const ok = Boolean(models.data?.length);
    await markOutcome(id, null, true);
    if (id !== "env") {
      await prisma.aiCredential.update({
        where: { id },
        data: { lastTestedAt: new Date(), status: "HEALTHY" },
      });
    }
    await recordUsage({
      credentialId: id,
      model: "models.list",
      operation: "test",
      success: ok,
      latencyMs: Date.now() - started,
    });
    await writeAudit({
      action: "credential_tested",
      entity: "ai_credential",
      entityId: id,
      actor: "operator",
      payload: { ok, model: "models.list" },
    });
    return {
      ok: true as const,
      name: cred.name,
      status: "SUCCESS" as const,
      model: "models.list",
      timestamp: new Date().toISOString(),
      errorCategory: null as string | null,
    };
  } catch (error) {
    const category = classifyOpenAIError(error);
    await markOutcome(id, category, false, error);
    if (id !== "env") {
      await prisma.aiCredential.update({
        where: { id },
        data: { lastTestedAt: new Date() },
      });
    }
    await recordUsage({
      credentialId: id,
      model: "models.list",
      operation: "test",
      success: false,
      errorCategory: category,
      latencyMs: Date.now() - started,
    });
    await writeAudit({
      action: "credential_tested",
      entity: "ai_credential",
      entityId: id,
      actor: "operator",
      payload: { ok: false, errorCategory: category, model: "models.list" },
    });
    return {
      ok: false as const,
      name: cred.name,
      status: "FAILED" as const,
      model: "models.list",
      timestamp: new Date().toISOString(),
      errorCategory: category,
    };
  }
}

export async function runWithOpenAICredential<T>(input: {
  operation: string;
  model: string;
  execute: (client: OpenAI) => Promise<T>;
  readUsage?: (result: T) => { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
}): Promise<{ result: T; credentialId: string; credentialName: string }> {
  const policy = await getCredentialPolicy();
  const resolved = await resolveAll();
  const eligible = resolved.filter((item) => isEligible(item));
  if (eligible.length === 0) {
    throw resolved.length === 0
      ? new Error("AI is not configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY or add a credential in Settings.")
      : new AllOpenAICredentialsUnavailableError([]);
  }

  const startedBy = new Map<string, number>();
  const outcome = await runCredentialedOperation({
    policy: policy.policy,
    failover: policy.failover,
    roundRobinIndex: policy.roundRobinIndex,
    credentials: eligible.map((item) => ({
      id: item.id,
      name: item.name,
      lastUsedAt: item.lastUsedAt,
    })),
    execute: async (credentialId) => {
      const cred = eligible.find((item) => item.id === credentialId);
      if (!cred) throw new AllOpenAICredentialsUnavailableError([credentialId]);
      startedBy.set(credentialId, Date.now());
      const client = createAIClient(cred.apiKey, { timeout: 60_000 });
      return input.execute(client);
    },
    onAttempt: async ({ credentialId, success, category, error }) => {
      const cred = eligible.find((item) => item.id === credentialId);
      const latencyMs = Date.now() - (startedBy.get(credentialId) ?? Date.now());
      await markOutcome(credentialId, category, success, error);
      if (!success) {
        await recordUsage({
          credentialId,
          model: input.model,
          operation: input.operation,
          success: false,
          errorCategory: category,
          latencyMs,
        });
      }
      logOperation({
        credentialId,
        credentialName: cred?.name ?? credentialId,
        operation: input.operation,
        model: input.model,
        success,
        duration: latencyMs,
        category,
      });
    },
  });

  const usage = input.readUsage?.(outcome.result) ?? null;
  await recordUsage({
    credentialId: outcome.credentialId,
    model: input.model,
    operation: input.operation,
    success: true,
    latencyMs: Date.now() - (startedBy.get(outcome.credentialId) ?? Date.now()),
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  });

  if (policy.policy === "ROUND_ROBIN") {
    await saveCredentialPolicy({ roundRobinIndex: outcome.nextIndex });
  }

  return {
    result: outcome.result,
    credentialId: outcome.credentialId,
    credentialName: outcome.credentialName,
  };
}
