import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { currentPrincipal } from "@/lib/auth/context";
import { defaultTenantId } from "@/lib/auth/config";
import { stopSequencesForLead } from "@/lib/outreach/sequence";

export type DeliveryKind = "BOUNCE" | "UNSUBSCRIBE" | "REPLY";

function tenantFor(explicit?: string | null) {
  return explicit || currentPrincipal()?.tenantId || defaultTenantId();
}

export async function applyDeliveryEvent(input: {
  provider: string;
  providerEventId: string;
  type: DeliveryKind;
  email?: string | null;
  leadId?: string | null;
  draftId?: string | null;
  tenantId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const providerEventId = input.providerEventId.trim();
  if (!providerEventId) throw new Error("providerEventId is required.");
  const existing = await prisma.deliveryEvent.findUnique({
    where: { provider_providerEventId: { provider: input.provider, providerEventId } },
  });
  if (existing) {
    return { ok: true as const, duplicate: true, id: existing.id, type: existing.type };
  }
  const email = input.email?.trim().toLowerCase() || null;
  let leadId = input.leadId ?? null;
  if (!leadId && email) {
    const lead = await prisma.lead.findFirst({ where: { email }, orderBy: { updatedAt: "desc" } });
    leadId = lead?.id ?? null;
  }
  const tenantId = tenantFor(input.tenantId);
  const created = await prisma.deliveryEvent.create({
    data: {
      provider: input.provider,
      providerEventId,
      type: input.type,
      email,
      leadId,
      draftId: input.draftId ?? null,
      tenantId,
      payload: (input.payload ?? {}) as object,
    },
  });
  if (input.type === "REPLY") {
    return { ok: true as const, duplicate: false, id: created.id, type: created.type, leadId };
  }
  const reason = input.type === "BOUNCE" ? "bounce" : "unsubscribe";
  if (email) {
    await prisma.suppression.upsert({
      where: { email },
      update: { reason },
      create: { email, reason },
    });
  }
  let stopped = 0;
  if (leadId) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        suppressed: true,
        status: "DO_NOT_CONTACT",
        lastActivityAt: new Date(),
        ...(input.type === "BOUNCE" ? { bouncedAt: new Date() } : {}),
      },
    });
    stopped = await stopSequencesForLead(leadId, input.type);
    await prisma.outreachEvent.create({
      data: {
        leadId,
        draftId: input.draftId ?? null,
        type: input.type,
        channel: "EMAIL",
        tenantId,
        payload: { provider: input.provider, providerEventId, email },
      },
    });
    const { recordLeadOutcome } = await import("@/lib/intelligence/outcome");
    await recordLeadOutcome({
      leadId,
      channel: "EMAIL",
      draftId: input.draftId ?? null,
      patch: {
        bounced: input.type === "BOUNCE",
        unsubscribe: input.type === "UNSUBSCRIBE",
        sequenceStopped: true,
        noResponse: false,
      },
    });
  }
  await writeAudit({
    action: input.type === "BOUNCE" ? "outreach.bounce" : "outreach.unsubscribe",
    entity: "lead",
    entityId: leadId,
    payload: { email, provider: input.provider, providerEventId, stopped },
  });
  return { ok: true as const, duplicate: false, id: created.id, type: input.type, leadId, stopped };
}

export function unsubscribeEventId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
