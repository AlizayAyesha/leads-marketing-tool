import "server-only";

import { prisma } from "@/lib/db/prisma";
import { remember } from "@/lib/brain/memory";
import { canDraftFiverrResponse, qualifyFiverrRequest } from "@/lib/platforms/fiverr/qualify";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const SUBJECT = "Follow-up (human approval)";

export class FiverrFollowUpAgent implements PlatformAgent {
  id = "fiverr_followup";
  name = "Fiverr Follow-Up Agent";
  platform = "fiverr";
  capabilities = ["follow_up_fiverr"] as const;
  permissions = ["draft_response", "no_external_submit"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    const forcedId = String(task.payload?.proposalId ?? "");
    const submitted = forcedId
      ? await prisma.freelanceProposal.findMany({ where: { id: forcedId, kind: "FIVERR_RESPONSE" } })
      : await prisma.freelanceProposal.findMany({
          where: {
            kind: "FIVERR_RESPONSE",
            status: "SUBMITTED",
            submittedAt: { lte: new Date(Date.now() - FOLLOW_UP_AFTER_MS) },
          },
          take: 8,
          include: { inquiry: true, opportunity: true },
        });

    const drafted = [];
    for (const row of submitted) {
      const full = await prisma.freelanceProposal.findUnique({
        where: { id: row.id },
        include: { inquiry: true, opportunity: true },
      });
      if (!full?.inquiryId || !full.submittedAt) continue;
      const existing = await prisma.freelanceProposal.findFirst({
        where: { inquiryId: full.inquiryId, subject: SUBJECT },
      });
      if (existing) continue;
      const message = full.inquiry?.message ?? full.opportunity?.description ?? "";
      const fit = qualifyFiverrRequest({
        title: full.opportunity?.title,
        message,
        budget: full.opportunity?.budget,
        budgetAmount: full.opportunity?.budgetAmount,
        buyerName: full.inquiry?.buyerName ?? full.opportunity?.clientName,
      });
      if (!canDraftFiverrResponse(fit.band)) continue;
      const body = [
        `Hi${full.inquiry?.buyerName ? ` ${full.inquiry.buyerName}` : ""},`,
        "",
        "Just checking whether this is still on your list. Happy to answer one scoping question if useful — otherwise I will leave it here.",
        "",
        "— your business",
      ].join("\n");
      const proposal = await prisma.freelanceProposal.create({
        data: {
          inquiryId: full.inquiryId,
          opportunityId: full.opportunityId,
          kind: "FIVERR_RESPONSE",
          subject: SUBJECT,
          body,
          status: "AWAITING_APPROVAL",
          mode: "heuristic",
        },
      });
      drafted.push(proposal.id);
    }

    await remember({
      platform: "fiverr",
      kind: "follow_up_prepared",
      subject: "Fiverr follow-up",
      content: `Prepared ${drafted.length} conservative follow-up draft(s). Nothing was sent.`,
      metadata: { proposalIds: drafted },
    });
    return { ok: true, output: { drafted: drafted.length, proposalIds: drafted } };
  }
}
