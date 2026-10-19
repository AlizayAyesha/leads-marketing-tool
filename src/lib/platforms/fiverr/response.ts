import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { generateJson } from "@/lib/ai/provider";
import { remember, recall } from "@/lib/brain/memory";
import { canDraftFiverrResponse, qualifyFiverrRequest } from "@/lib/platforms/fiverr/qualify";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

export class FiverrResponseAgent implements PlatformAgent {
  id = "fiverr_response";
  name = "Fiverr Response Agent";
  platform = "fiverr";
  capabilities = ["draft_fiverr_response"] as const;
  permissions = ["draft_response", "no_external_submit"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    const id = String(task.payload?.inquiryId ?? "");
    const inquiry = await prisma.buyerInquiry.findUnique({
      where: { id },
      include: { opportunity: true },
    });
    if (!inquiry) return { ok: false, output: null, error: "Inquiry not found." };

    const fit = qualifyFiverrRequest({
      title: inquiry.opportunity?.title ?? "Buyer inquiry",
      message: inquiry.message,
      budget: inquiry.opportunity?.budget,
      budgetAmount: inquiry.opportunity?.budgetAmount,
      buyerName: inquiry.buyerName,
      location: inquiry.opportunity?.location,
    });
    if (!canDraftFiverrResponse(fit.band)) {
      await prisma.buyerInquiry.update({ where: { id }, data: { status: "SKIPPED" } });
      if (inquiry.opportunityId) {
        await prisma.freelanceOpportunity.update({
          where: { id: inquiry.opportunityId },
          data: {
            fitScore: fit.total,
            classification: fit.classification,
            status: "SKIPPED",
            recommendedAction: fit.recommendedAction,
            qualifyReasons: fit.reasons,
            risks: fit.risks,
          },
        });
      }
      return {
        ok: true,
        output: {
          skipped: true,
          band: fit.band,
          score: fit.total,
          recommendedAction: fit.recommendedAction,
        },
      };
    }

    const memory = await recall({ platform: "fiverr", take: 8 });
    const draft = await writeResponse({
      message: inquiry.message,
      buyerName: inquiry.buyerName,
      fit,
      lessons: memory.map((item) => item.content),
    });

    const proposal = await prisma.freelanceProposal.create({
      data: {
        inquiryId: inquiry.id,
        opportunityId: inquiry.opportunityId,
        kind: "FIVERR_RESPONSE",
        subject: fit.band === "RESPOND" ? "Buyer reply draft" : "Buyer reply draft — REVIEW",
        body: draft.body,
        status: "AWAITING_APPROVAL",
        mode: draft.mode,
      },
    });
    await prisma.buyerInquiry.update({
      where: { id },
      data: { status: "AWAITING_APPROVAL" },
    });
    if (inquiry.opportunityId) {
      await prisma.freelanceOpportunity.update({
        where: { id: inquiry.opportunityId },
        data: {
          fitScore: fit.total,
          classification: fit.classification,
          recommendedAction: fit.recommendedAction,
          qualifyReasons: fit.reasons,
          risks: fit.risks,
        },
      });
    }
    await remember({
      platform: "fiverr",
      kind: "response_prepared",
      subject: inquiry.buyerName || "Fiverr buyer",
      content: `Draft reply ${fit.band} (${fit.total}). Status AWAITING_APPROVAL. Nothing was sent.`,
      metadata: { proposalId: proposal.id, inquiryId: id, band: fit.band },
    });
    return {
      ok: true,
      output: {
        proposalId: proposal.id,
        status: "AWAITING_APPROVAL",
        band: fit.band,
        score: fit.total,
        recommendedAction: fit.recommendedAction,
      },
    };
  }
}

async function writeResponse(input: {
  message: string;
  buyerName: string | null;
  fit: ReturnType<typeof qualifyFiverrRequest>;
  lessons: string[];
}) {
  const quote = input.message.replace(/\s+/g, " ").trim().slice(0, 220);
  const heuristic = [
    `Hi${input.buyerName ? ` ${input.buyerName}` : ""},`,
    "",
    `You mentioned that ${quote}${quote.length >= 220 ? "…" : ""}`,
    "",
    input.fit.offerFamily
      ? `That maps to ${getBusinessProfile().businessName} ${input.fit.offerFamily.replaceAll("_", " ").toLowerCase()}: we would start with a scoped first milestone (workflow + handoff), not an open-ended package.`
      : "If this is still the problem, I can outline a first milestone before talking packages.",
    "",
    "Expected outcome of week one: a written flow of what happens to a lead from first message to CRM, plus what we would automate vs leave manual.",
    "I will not invent past Fiverr reviews or case studies here.",
    "",
    "If that matches, reply with the CRM/WhatsApp tools you already use and I will confirm fit before any order.",
    "",
    "— your business",
  ].join("\n");

  await refreshCredentialCache();
  const provider = getAIProvider();
  if (!provider.configured) return { body: heuristic, mode: "heuristic" as const };
  try {
    const { data } = await generateJson<{ body: string }>(provider, [
      {
        role: "system",
        content:
          "Draft a Fiverr buyer reply. Quote their problem. Map one your business capability. Specific approach, expected outcome, no fabricated proof. Low-friction CTA. DRAFT ONLY. JSON { body }.",
      },
      { role: "user", content: JSON.stringify({ ...input, heuristic, lessons: input.lessons }) },
    ]);
    return { body: data.body || heuristic, mode: "openai" as const };
  } catch {
    return { body: heuristic, mode: "heuristic" as const };
  }
}
