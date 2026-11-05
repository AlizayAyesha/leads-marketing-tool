import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { billingStatus } from "@/lib/billing/status";
import { usageSummary } from "@/lib/billing/ledger";
import { describeAuthConfig } from "@/lib/auth/config";
import { evaluateSenderConfiguration } from "@/lib/outreach/sender-config";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { prisma } from "@/lib/db/prisma";
import { approveDraft, rejectDraft } from "@/lib/actions/outreach";

export const GET = withUser(async (_request, principal) => {
  const [usage, policy] = await Promise.all([usageSummary(principal.tenantId), getOutreachEnginePolicy()]);
  return NextResponse.json({
    contractVersion: "1",
    principal: { sub: principal.sub, email: principal.email, role: principal.role, tenantId: principal.tenantId },
    auth: describeAuthConfig(),
    sender: evaluateSenderConfiguration(),
    billing: billingStatus(),
    usage,
    policy: {
      sendsPaused: policy.sendsPaused,
      sendMode: policy.sendMode,
      dailySendLimit: policy.dailySendLimit,
      emailEnabled: policy.emailEnabled,
    },
  });
});

export const approve = withUser(async (_request, _principal, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const result = await approveDraft(id);
  return NextResponse.json({ ...result, sent: "sent" in result ? result.sent : false });
});

export const reject = withUser(async (request, _principal, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  await rejectDraft(id, body.reason || "Rejected by operator");
  return NextResponse.json({ ok: true, sent: false });
});

export const leads = withUser(async (_request, principal) => {
  const rows = await prisma.lead.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      leadId: true,
      name: true,
      company: true,
      email: true,
      status: true,
      suppressed: true,
      bouncedAt: true,
      tenantId: true,
    },
  });
  return NextResponse.json({ tenantId: principal.tenantId, leads: rows });
});
