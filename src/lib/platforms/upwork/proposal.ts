import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { generateJson } from "@/lib/ai/provider";
import { remember, recall } from "@/lib/brain/memory";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

export class UpworkProposalAgent implements PlatformAgent {
  id = "upwork_proposal";
  name = "Upwork Proposal Agent";
  platform = "upwork";
  capabilities = ["prepare_upwork_proposal"] as const;
  permissions = ["draft_proposal", "no_external_submit"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    const id = String(task.payload?.opportunityId ?? "");
    const opportunity = await prisma.freelanceOpportunity.findUnique({ where: { id } });
    if (!opportunity) return { ok: false, output: null, error: "Opportunity not found." };

    const memory = await recall({ platform: "upwork", take: 8 });
    const draft = await writeProposal(opportunity, memory.map((item) => item.content));

    const proposal = await prisma.freelanceProposal.create({
      data: {
        opportunityId: opportunity.id,
        kind: "UPWORK_PROPOSAL",
        subject: `Proposal: ${opportunity.title}`,
        body: draft.body,
        status: "AWAITING_APPROVAL",
        mode: draft.mode,
      },
    });
    await prisma.freelanceOpportunity.update({
      where: { id },
      data: { status: "AWAITING_APPROVAL" },
    });
    await remember({
      platform: "upwork",
      kind: "proposal_prepared",
      subject: opportunity.title,
      content: "Draft proposal created. Status AWAITING_APPROVAL. Nothing was submitted.",
      metadata: { proposalId: proposal.id, opportunityId: id },
    });
    return { ok: true, output: { proposalId: proposal.id, status: "AWAITING_APPROVAL" } };
  }
}

async function writeProposal(
  opportunity: {
    title: string;
    description: string | null;
    clientName: string | null;
    budget: string | null;
    recommendedService: string | null;
  },
  lessons: string[],
) {
  const heuristic = [
    `Hi${opportunity.clientName ? ` ${opportunity.clientName}` : ""},`,
    "",
    `I read “${opportunity.title}” and the main problem appears to be getting this built cleanly without extra process.`,
    opportunity.description
      ? `From the brief: ${opportunity.description.slice(0, 280)}`
      : "The listing text is limited, so I would start by confirming scope rather than guessing.",
    "",
    opportunity.recommendedService
      ? `${getBusinessProfile().businessName} can help with ${opportunity.recommendedService.replaceAll("_", " ").toLowerCase()} if the fit still holds after a short scoping call.`
      : "If this is a custom build, we can scope it against what you already have.",
    "",
    "I am not attaching invented case studies. If useful, I can walk through a similar public project we actually shipped.",
    "",
    "Happy to outline a first milestone after you confirm must-haves.",
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
          "Write a concise Upwork proposal for your business. Do not invent portfolio items, clients, or metrics. Do not sound like agency spam. Return JSON { body }.",
      },
      {
        role: "user",
        content: JSON.stringify({ opportunity, lessons, heuristic }),
      },
    ]);
    return { body: data.body || heuristic, mode: "openai" as const };
  } catch {
    return { body: heuristic, mode: "heuristic" as const };
  }
}
