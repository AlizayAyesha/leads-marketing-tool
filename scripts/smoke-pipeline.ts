import { IntakeAgent } from "../src/lib/agents/intake";
import { DEFAULT_PROMPTS } from "../src/lib/prompts/defaults";
import { runLeadPipeline } from "../src/lib/pipeline/run";
import { prisma } from "../src/lib/db/prisma";

async function main() {
  const intake = new IntakeAgent();
  const result = await intake.execute({
    prompt: DEFAULT_PROMPTS.intake.content,
    payload: {
      sourceName: "pipeline-smoke",
      leads: [
        {
          name: "Amina Shah",
          company: "Northline Clinic",
          website: "https://example.com",
          email: "amina@example.com",
          linkedinUrl: "https://www.linkedin.com/in/example",
          source: "smoke",
          industry: "Healthcare",
          location: "Lahore",
          originalPost: "Looking for a clearer patient intake website",
        },
      ],
    },
  });
  console.log("intake", result.output);
  const lead = await prisma.lead.findFirst({ where: { email: "amina@example.com" } });
  if (!lead) throw new Error("lead missing");
  const pipeline = await runLeadPipeline(lead.id);
  console.log("pipeline", pipeline);
  const fresh = await prisma.lead.findUnique({
    where: { id: lead.id },
    include: { scores: true, research: true, opportunities: true, drafts: true },
  });
  console.log({
    status: fresh?.status,
    temperature: fresh?.temperature,
    score: fresh?.scores[0]?.score,
    service: fresh?.opportunities[0]?.recommendedService,
    draftStatus: fresh?.drafts[0]?.status,
    findings: Array.isArray(fresh?.research[0]?.findings)
      ? fresh?.research[0]?.findings.length
      : 0,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
