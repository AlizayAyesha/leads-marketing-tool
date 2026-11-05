import "server-only";

import { prisma } from "@/lib/db/prisma";
import { currentPrincipal } from "@/lib/auth/context";
import { defaultTenantId } from "@/lib/auth/config";
import { usageAllows } from "@/lib/outreach/pre-send";

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isMissingTable(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : "";
  return code === "P2021" || code === "P2022";
}

export async function reserveSendUsage(input: { tenantId?: string | null; draftId: string; limit: number }) {
  const tenantId = input.tenantId || currentPrincipal()?.tenantId || defaultTenantId();
  const idempotencyKey = `email_send:${input.draftId}`;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:email_send`}))`;
      const existing = await tx.usageEntry.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      });
      if (existing && existing.status !== "released") {
        return { ok: true as const, reserved: false, already: true };
      }
      const used = await tx.usageEntry.count({
        where: {
          tenantId,
          metric: "email_send",
          status: { in: ["reserved", "committed"] },
          createdAt: { gte: startOfUtcDay() },
        },
      });
      if (!usageAllows({ used, limit: input.limit })) {
        return { ok: false as const, code: "QUOTA_EXCEEDED" as const, message: "Daily send quota is exhausted." };
      }
      if (existing) {
        await tx.usageEntry.update({ where: { id: existing.id }, data: { status: "reserved" } });
      } else {
        await tx.usageEntry.create({
          data: {
            tenantId,
            metric: "email_send",
            quantity: 1,
            status: "reserved",
            idempotencyKey,
            draftId: input.draftId,
          },
        });
      }
      return { ok: true as const, reserved: true, already: false };
    });
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        ok: false as const,
        code: "USAGE_LEDGER_UNAVAILABLE" as const,
        message: "Usage ledger tables are not migrated. Sending is blocked until the ledger exists.",
      };
    }
    throw error;
  }
}

export async function commitSendUsage(draftId: string, tenantId?: string | null) {
  const id = tenantId || currentPrincipal()?.tenantId || defaultTenantId();
  await prisma.usageEntry.updateMany({
    where: { tenantId: id, idempotencyKey: `email_send:${draftId}` },
    data: { status: "committed" },
  });
}

export async function releaseSendUsage(draftId: string, tenantId?: string | null) {
  const id = tenantId || currentPrincipal()?.tenantId || defaultTenantId();
  await prisma.usageEntry.updateMany({
    where: { tenantId: id, idempotencyKey: `email_send:${draftId}`, status: "reserved" },
    data: { status: "released" },
  });
}

export async function usageSummary(tenantId?: string | null) {
  const id = tenantId || currentPrincipal()?.tenantId || defaultTenantId();
  const since = startOfUtcDay();
  try {
    const [sends, released] = await Promise.all([
      prisma.usageEntry.count({
        where: { tenantId: id, metric: "email_send", status: { in: ["reserved", "committed"] }, createdAt: { gte: since } },
      }),
      prisma.usageEntry.count({
        where: { tenantId: id, metric: "email_send", status: "released", createdAt: { gte: since } },
      }),
    ]);
    return { ok: true as const, tenantId: id, emailSendsToday: sends, releasedToday: released };
  } catch (error) {
    if (isMissingTable(error)) {
      return { ok: false as const, tenantId: id, emailSendsToday: null, releasedToday: null, code: "USAGE_LEDGER_UNAVAILABLE" };
    }
    throw error;
  }
}
