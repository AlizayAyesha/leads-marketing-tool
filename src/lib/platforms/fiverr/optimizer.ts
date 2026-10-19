import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { generateJson } from "@/lib/ai/provider";
import { remember } from "@/lib/brain/memory";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

export type GigOptimization = {
  title_suggestions: string[];
  description_improvements: string[];
  keyword_suggestions: string[];
  package_recommendations: string[];
  faq_suggestions: string[];
  portfolio_recommendations: string[];
  conversion_issues: string[];
};

export type GigFunnel = {
  impressions: number | null;
  clicks: number | null;
  messages: number | null;
  orders: number | null;
  revenue: number | null;
  reviews: number | null;
};

export type GigExperiment = {
  status: "idle" | "proposed" | "running" | "complete";
  startedAt: string | null;
  minDays: number;
  currentTitle: string;
  variantTitle: string;
  keep: "current" | "variant" | null;
  note: string;
};

export type StoredGigAnalysis = {
  recommendations: GigOptimization;
  funnel: GigFunnel;
  experiment: GigExperiment;
};

export const GIG_EXPERIMENT_MIN_DAYS = 7;

function parseStoredAnalysis(raw: unknown): StoredGigAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.recommendations && row.experiment) return raw as StoredGigAnalysis;
  return null;
}

export class FiverrGigOptimizerAgent implements PlatformAgent {
  id = "fiverr_optimizer";
  name = "Fiverr Gig Optimizer Agent";
  platform = "fiverr";
  capabilities = ["optimize_fiverr_gig", "analyze_fiverr_gigs"] as const;
  permissions = ["read_imported_gigs"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    const id = String(task.payload?.gigId ?? "");
    const gig = id
      ? await prisma.gigProfile.findUnique({ where: { id } })
      : await prisma.gigProfile.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!gig) return { ok: false, output: null, error: "Import a gig first." };

    const previous = parseStoredAnalysis(gig.analysis);
    if (task.type === "start_experiment") {
      if (!previous?.experiment.variantTitle) {
        return { ok: false, output: null, error: "Analyze the gig first so a variant title exists." };
      }
      if (previous.experiment.status === "running") {
        return { ok: false, output: previous, error: "An experiment is already running. Do not start another." };
      }
      const next: StoredGigAnalysis = {
        ...previous,
        experiment: {
          ...previous.experiment,
          status: "running",
          startedAt: new Date().toISOString(),
          note: `Test one change for ${GIG_EXPERIMENT_MIN_DAYS} days. Jarvis will not auto-publish to Fiverr.`,
        },
      };
      await prisma.gigProfile.update({ where: { id: gig.id }, data: { analysis: next } });
      return { ok: true, output: { gigId: gig.id, analysis: next } };
    }

    if (previous?.experiment.status === "running" && previous.experiment.startedAt) {
      const elapsed = Date.now() - Date.parse(previous.experiment.startedAt);
      if (Number.isFinite(elapsed) && elapsed < GIG_EXPERIMENT_MIN_DAYS * 24 * 60 * 60 * 1000) {
        return {
          ok: true,
          output: {
            gigId: gig.id,
            analysis: previous,
            blocked: true,
            reason: `Experiment still running. Wait ${GIG_EXPERIMENT_MIN_DAYS} days before proposing another gig change.`,
          },
        };
      }
    }

    const recommendations = await optimizeGig({
      title: gig.title,
      description: gig.description,
      keywords: Array.isArray(gig.keywords) ? gig.keywords.map(String) : [],
    });
    const variantTitle = recommendations.title_suggestions[0] ?? `${gig.title} — outcome-first title (test)`;
    const analysis: StoredGigAnalysis = {
      recommendations,
      funnel: previous?.funnel ?? {
        impressions: null,
        clicks: null,
        messages: null,
        orders: null,
        revenue: null,
        reviews: null,
      },
      experiment: {
        status: "proposed",
        startedAt: null,
        minDays: GIG_EXPERIMENT_MIN_DAYS,
        currentTitle: gig.title,
        variantTitle,
        keep: null,
        note: "Do not change the live gig every day. Start one title experiment, then compare funnel metrics.",
      },
    };
    await prisma.gigProfile.update({
      where: { id: gig.id },
      data: { analysis },
    });
    await remember({
      platform: "fiverr",
      kind: "gig_analyzed",
      subject: gig.title,
      content: "Gig analysis stored as a test proposal. No ranking claims. Live gig was not edited.",
      metadata: { gigId: gig.id },
    });
    return { ok: true, output: { gigId: gig.id, analysis } };
  }
}

async function optimizeGig(input: {
  title: string;
  description: string | null;
  keywords: string[];
}): Promise<GigOptimization> {
  const heuristic: GigOptimization = {
    title_suggestions: [
      `${input.title} — worth testing a clearer outcome in the first 40 characters`,
      `Custom ${input.title.replace(/gig/i, "").trim() || "web build"} with scoped milestones`,
    ],
    description_improvements: [
      "Lead with the buyer problem, then the first deliverable.",
      "State what is not included so revisions stay bounded.",
    ],
    keyword_suggestions: [
      ...input.keywords.slice(0, 5),
      "website development",
      "custom web app",
    ].filter((item, index, all) => all.indexOf(item) === index),
    package_recommendations: [
      "Basic: single-page or audit.",
      "Standard: multi-page site with one revision cycle.",
      "Premium: custom build with a written milestone plan.",
    ],
    faq_suggestions: [
      "What do you need from me to start?",
      "How many revision rounds are included?",
    ],
    portfolio_recommendations: [
      "Show one real before/after, not a generic collage.",
      "Do not invent case studies.",
    ],
    conversion_issues: [
      input.description && input.description.length < 120
        ? "Description is short; buyers may not see scope."
        : "Confirm the first package has a concrete deliverable.",
    ],
  };

  await refreshCredentialCache();
  const provider = getAIProvider();
  if (!provider.configured) return heuristic;
  try {
    const { data } = await generateJson<GigOptimization>(provider, [
      {
        role: "system",
        content:
          "Optimize a Fiverr gig. Never claim a keyword will rank. Use phrases like potentially useful, worth testing, appears relevant. Return the GigOptimization JSON keys only.",
      },
      { role: "user", content: JSON.stringify({ input, heuristic }) },
    ]);
    return { ...heuristic, ...data };
  } catch {
    return heuristic;
  }
}
