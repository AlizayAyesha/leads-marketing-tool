"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { getPlatformAgent } from "@/lib/platforms/registry";
import { remember } from "@/lib/brain/memory";
import { FiverrTool } from "@/lib/tools/fiverr";
import { UpworkTool } from "@/lib/tools/upwork";
import { writeAudit } from "@/lib/db/settings";
import {
  fiverrRecordToPayload,
  readPlatformSheet,
  upworkRecordToPayload,
} from "@/lib/google/sync";
import { IntegrationPendingError } from "@/lib/data-sources/types";

function refresh(opportunityId?: string | null) {
  revalidatePath("/freelance");
  revalidatePath("/freelance/gigs");
  revalidatePath("/jarvis");
  if (opportunityId) revalidatePath(`/freelance/${opportunityId}`);
}

export async function importUpworkListing(formData: FormData) {
  const result = await getPlatformAgent("upwork").execute({
    type: "import",
    payload: Object.fromEntries(formData.entries()),
  });
  refresh();
  return result;
}

export async function importFiverrGig(formData: FormData) {
  const result = await getPlatformAgent("fiverr").execute({
    type: "import_gig",
    payload: Object.fromEntries(formData.entries()),
  });
  refresh();
  return result;
}

export async function importUpworkFromSheet() {
  try {
    const sheet = await readPlatformSheet("upwork");
    if (!sheet.ok) return { ok: false, error: sheet.error, imported: 0 };
    let imported = 0;
    const errors: string[] = [];
    for (const record of sheet.records) {
      const payload = upworkRecordToPayload(record);
      if (!payload.title) continue;
      const result = await getPlatformAgent("upwork").execute({ type: "import", payload });
      if (result.ok) imported += 1;
      else if (result.error) errors.push(result.error);
    }
    refresh();
    return { ok: true, imported, worksheet: sheet.worksheet, errors };
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      error: error instanceof IntegrationPendingError || error instanceof Error ? error.message : "Upwork sheet import failed.",
    };
  }
}

export async function importFiverrFromSheet() {
  try {
    const sheet = await readPlatformSheet("fiverr");
    if (!sheet.ok) return { ok: false, error: sheet.error, imported: 0 };
    let imported = 0;
    const errors: string[] = [];
    for (const record of sheet.records) {
      const payload = fiverrRecordToPayload(record);
      if (payload.kind === "inquiry") {
        if (!payload.message) continue;
        const result = await getPlatformAgent("fiverr").execute({
          type: "import_inquiry",
          payload,
        });
        if (result.ok) imported += 1;
        else if (result.error) errors.push(result.error);
      } else {
        if (!payload.title) continue;
        const result = await getPlatformAgent("fiverr").execute({
          type: "import_gig",
          payload,
        });
        if (result.ok) imported += 1;
        else if (result.error) errors.push(result.error);
      }
    }
    refresh();
    return { ok: true, imported, worksheet: sheet.worksheet, errors };
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      error: error instanceof IntegrationPendingError || error instanceof Error ? error.message : "Fiverr sheet import failed.",
    };
  }
}

export async function importFiverrInquiry(formData: FormData) {
  const result = await getPlatformAgent("fiverr").execute({
    type: "import_inquiry",
    payload: Object.fromEntries(formData.entries()),
  });
  refresh();
  return result;
}

export async function qualifyOpportunityAction(opportunityId: string) {
  const opportunity = await prisma.freelanceOpportunity.findUnique({ where: { id: opportunityId } });
  const agentId = opportunity?.platform === "FIVERR" ? "fiverr_qualify" : "upwork_qualification";
  const result = await getPlatformAgent(agentId).execute({
    type: "qualify",
    payload: { opportunityId },
  });
  revalidatePath(`/freelance/${opportunityId}`);
  refresh();
  return result;
}

export async function prepareProposalAction(opportunityId: string) {
  const opportunity = await prisma.freelanceOpportunity.findUnique({ where: { id: opportunityId } });
  if (opportunity?.platform === "FIVERR") {
    const inquiry = await prisma.buyerInquiry.findFirst({ where: { opportunityId } });
    if (inquiry) return draftInquiryAction(inquiry.id);
  }
  const result = await getPlatformAgent("upwork_proposal").execute({
    type: "prepare",
    payload: { opportunityId },
  });
  revalidatePath(`/freelance/${opportunityId}`);
  refresh();
  return result;
}

export async function optimizeGigAction(gigId: string) {
  const result = await getPlatformAgent("fiverr_optimizer").execute({
    type: "optimize",
    payload: { gigId },
  });
  refresh();
  return result;
}

export async function startGigExperimentAction(gigId: string) {
  const result = await getPlatformAgent("fiverr_optimizer").execute({
    type: "start_experiment",
    payload: { gigId },
  });
  refresh();
  return result;
}

export async function runFiverrIntelligenceAction() {
  const result = await getPlatformAgent("fiverr_intelligence").execute({ type: "market" });
  refresh();
  return result;
}

export async function runFiverrFollowUpAction() {
  const result = await getPlatformAgent("fiverr_followup").execute({ type: "follow_up" });
  refresh();
  return result;
}

export async function draftInquiryAction(inquiryId: string) {
  const result = await getPlatformAgent("fiverr_response").execute({
    type: "draft",
    payload: { inquiryId },
  });
  refresh();
  return result;
}

export async function approveProposal(proposalId: string) {
  const proposal = await prisma.freelanceProposal.update({
    where: { id: proposalId },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  if (proposal.opportunityId) {
    await prisma.freelanceOpportunity.update({
      where: { id: proposal.opportunityId },
      data: { status: "APPROVED" },
    });
  }
  await remember({
    platform: proposal.kind === "UPWORK_PROPOSAL" ? "upwork" : "fiverr",
    kind: "proposal_approved",
    subject: proposal.subject || proposal.kind,
    content: "Human approved the draft. External submit is still unavailable.",
    metadata: { proposalId },
  });
  await writeAudit({ action: "freelance.approve", entity: "freelance_proposal", entityId: proposalId });
  refresh(proposal.opportunityId);
  return {
    ok: true,
    message: "Approved. External marketplace submit is not wired — no unofficial API will be called.",
  };
}

export async function rejectProposal(proposalId: string, reason: string) {
  const proposal = await prisma.freelanceProposal.update({
    where: { id: proposalId },
    data: { status: "REJECTED", rejectionReason: reason || "Rejected by operator" },
  });
  await writeAudit({ action: "freelance.reject", entity: "freelance_proposal", entityId: proposalId });
  refresh(proposal.opportunityId);
}

export async function editProposal(proposalId: string, body: string) {
  const proposal = await prisma.freelanceProposal.update({
    where: { id: proposalId },
    data: { body, status: "AWAITING_APPROVAL" },
  });
  refresh(proposal.opportunityId);
}

export async function markProposalSubmitted(proposalId: string) {
  const upwork = new UpworkTool();
  const fiverr = new FiverrTool();
  const proposal = await prisma.freelanceProposal.findUnique({ where: { id: proposalId } });
  const remote =
    proposal?.kind === "FIVERR_RESPONSE" ? await fiverr.submitResponse() : await upwork.submitProposal();
  if (!remote.available) {
    await prisma.freelanceProposal.update({
      where: { id: proposalId },
      data: { status: "APPROVED" },
    });
    return { error: remote.error };
  }
  return { error: "Unexpected available submit path." };
}

export async function recordManualSubmit(proposalId: string) {
  const proposal = await prisma.freelanceProposal.update({
    where: { id: proposalId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  if (proposal.opportunityId) {
    await prisma.freelanceOpportunity.update({
      where: { id: proposal.opportunityId },
      data: { status: "SUBMITTED" },
    });
  }
  await remember({
    platform: proposal.kind === "UPWORK_PROPOSAL" ? "upwork" : "fiverr",
    kind: "proposal_submitted",
    subject: proposal.subject || proposal.kind,
    content: "Operator recorded a manual submit outside Jarvis. Jarvis did not call a marketplace API.",
    metadata: { proposalId },
  });
  refresh(proposal.opportunityId);
}
