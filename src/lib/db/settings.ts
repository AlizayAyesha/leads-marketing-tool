import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

function isUnreachableDb(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "P1001" || message.includes("Can't reach database server");
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  } catch (error) {
    if (isUnreachableDb(error)) return fallback;
    throw error;
  }
}

export async function setSetting(key: string, value: Prisma.InputJsonValue) {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function writeAudit(input: {
  action: string;
  entity: string;
  entityId?: string | null;
  actor?: string | null;
  payload?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      actor: input.actor ?? "operator",
      payload: (input.payload ?? {}) as object,
    },
  });
}

export type SuppressionState = "clear" | "suppressed" | "unknown";

export async function readSuppressionState(input: {
  email?: string | null;
  websiteHost?: string | null;
  phone?: string | null;
}): Promise<SuppressionState> {
  const email = input.email?.toLowerCase() ?? null;
  const domain = email?.split("@")[1] ?? input.websiteHost ?? null;
  const phone = input.phone ?? null;
  if (!email && !domain && !phone) return "clear";
  try {
    const match = await prisma.suppression.findFirst({
      where: {
        OR: [
          email ? { email } : undefined,
          domain ? { domain } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean) as object[],
      },
    });
    return match ? "suppressed" : "clear";
  } catch {
    return "unknown";
  }
}

export async function isSuppressed(input: {
  email?: string | null;
  websiteHost?: string | null;
  phone?: string | null;
}) {
  const state = await readSuppressionState(input);
  return state === "suppressed";
}
