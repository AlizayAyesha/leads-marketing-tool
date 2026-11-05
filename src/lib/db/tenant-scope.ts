import type { Prisma, PrismaClient } from "@prisma/client";

import { currentPrincipal } from "@/lib/auth/context";
import { authEnforcement, defaultTenantId } from "@/lib/auth/config";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/jwt";

/** Models that carry tenantId. Legacy null rows stay visible only to the default tenant. */
export const TENANT_SCOPED_MODELS = new Set([
  "Lead",
  "OutreachDraft",
  "OutreachEvent",
  "OutreachSequence",
  "OutreachReply",
  "Conversation",
  "Campaign",
  "Task",
  "GoogleConnection",
  "AiCredential",
  "GmailSenderAccount",
  "UsageEntry",
  "DeliveryEvent",
  "TenantSetting",
]);

type Row = { tenantId?: string | null };

export function tenantCanSee(rowTenantId: string | null | undefined, actorTenantId: string, env: NodeJS.ProcessEnv = process.env) {
  if (rowTenantId == null || rowTenantId === "") return actorTenantId === defaultTenantId(env);
  return rowTenantId === actorTenantId;
}

const REQUIRED_TENANT = new Set(["UsageEntry", "TenantSetting"]);

export function tenantReadFilter(tenantId: string, model = "", env: NodeJS.ProcessEnv = process.env) {
  if (REQUIRED_TENANT.has(model) || tenantId !== defaultTenantId(env)) return { tenantId };
  return { OR: [{ tenantId }, { tenantId: null }] };
}

type Scope = { kind: "all" } | { kind: "deny" } | { kind: "tenant"; tenantId: string };

async function resolveScope(): Promise<Scope> {
  const principal = currentPrincipal();
  if (principal?.scope === "all") return { kind: "all" };
  if (principal?.scope === "tenant") return { kind: "tenant", tenantId: principal.tenantId };
  if (authEnforcement() !== "required") return { kind: "all" };
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const raw = jar.get(SESSION_COOKIE)?.value;
    if (!raw) return { kind: "deny" };
    try {
      const session = await verifySessionToken(decodeURIComponent(raw));
      return { kind: "tenant", tenantId: session.tenantId };
    } catch {
      return { kind: "deny" };
    }
  } catch {
    return { kind: "all" };
  }
}

function andWhere(where: unknown, filter: Record<string, unknown>) {
  if (!where || typeof where !== "object") return filter;
  return { AND: [where, filter] };
}

function stampData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => stampData(row, tenantId));
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  if (typeof record.tenantId === "string" && record.tenantId) return data;
  return { ...record, tenantId };
}

function delegateName(model: string) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function extendTenantIsolation(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args);
          const scope = await resolveScope();
          if (scope.kind === "all") return query(args);
          if (scope.kind === "deny") {
            throw Object.assign(new Error("Sign in is required before tenant data can be read or changed."), {
              code: "UNAUTHENTICATED",
            });
          }
          const tenantId = scope.tenantId;
          const mutable = args as { where?: unknown; data?: unknown; create?: unknown };
          const listOps = new Set([
            "findMany",
            "findFirst",
            "findFirstOrThrow",
            "count",
            "aggregate",
            "groupBy",
            "updateMany",
            "deleteMany",
          ]);
          if (listOps.has(operation)) {
            mutable.where = andWhere(mutable.where, tenantReadFilter(tenantId, model));
            return query(args);
          }
          if (operation === "create" || operation === "createMany") {
            mutable.data = stampData(mutable.data, tenantId);
            return query(args);
          }

          const delegates = base as unknown as Record<string, { findUnique?: (input: { where: unknown }) => Promise<Row | null> }>;
          const existing =
            mutable.where && delegates[delegateName(model)]?.findUnique
              ? await delegates[delegateName(model)]!.findUnique!({ where: mutable.where })
              : null;
          if (existing && !tenantCanSee(existing.tenantId, tenantId)) {
            if (operation === "findUnique") return null;
            throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
          }
          if (operation === "upsert") {
            mutable.create = stampData(mutable.create, tenantId);
          }
          return query(args);
        },
      },
    },
  });
}

export type TenantFilter = Prisma.InputJsonObject;
