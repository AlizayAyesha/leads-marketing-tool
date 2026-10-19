import type { FitClassification, ZarService } from "@prisma/client";

export type QualifyInput = {
  title: string;
  description?: string | null;
  budgetAmount?: number | null;
  budget?: string | null;
  skills?: string[];
  serviceHint?: string | null;
};

export type QualifyResult = {
  score: number;
  classification: FitClassification;
  reasons: string[];
  risks: string[];
  recommendedAction: string;
  recommendedService: ZarService | null;
};

const SERVICE_KEYWORDS: { service: ZarService; needles: string[] }[] = [
  { service: "AI_AUTOMATION", needles: ["automat", "workflow", "zapier", "n8n"] },
  { service: "AI_CHATBOTS", needles: ["chatbot", "ai assistant", "support bot"] },
  { service: "AI_INTEGRATION", needles: ["openai", "llm", "gpt", "ai integration"] },
  { service: "SAAS_DEVELOPMENT", needles: ["saas", "subscription", "multi-tenant"] },
  { service: "WEBSITE_DEVELOPMENT", needles: ["website", "landing page", "wordpress", "web design"] },
  { service: "FULL_STACK_DEVELOPMENT", needles: ["full stack", "full-stack", "web app"] },
  { service: "CRM_ERP_DEVELOPMENT", needles: ["crm", "erp"] },
  { service: "SEO", needles: ["seo", "search ranking"] },
  { service: "UI_UX", needles: ["ui/ux", "ux design", "redesign"] },
  { service: "BRANDING", needles: ["brand", "logo", "identity"] },
];

export function inferService(text: string): ZarService | null {
  const hay = text.toLowerCase();
  for (const item of SERVICE_KEYWORDS) {
    if (item.needles.some((needle) => hay.includes(needle))) return item.service;
  }
  return null;
}

export function parseBudgetAmount(value?: string | null) {
  if (!value) return null;
  const match = value.replaceAll(",", "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function qualifyOpportunity(input: QualifyInput): QualifyResult {
  const text = `${input.title} ${input.description ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  const risks: string[] = [];
  const service = (input.serviceHint as ZarService | undefined) || inferService(text);
  let score = 35;

  if (service) {
    score += 20;
    reasons.push(`Observed service fit: ${service.replaceAll("_", " ").toLowerCase()}.`);
  } else {
    risks.push("No clear your business service keyword was observed.");
  }

  const budget = input.budgetAmount ?? parseBudgetAmount(input.budget);
  if (budget != null) {
    if (budget >= 1500 && budget <= 25000) {
      score += 18;
      reasons.push(`Budget amount ${budget} is in a workable range, if accurate.`);
    } else if (budget < 400) {
      score -= 15;
      risks.push("Budget is very low for custom software work.");
    } else {
      score += 6;
      reasons.push(`Budget amount ${budget} was provided.`);
    }
  } else {
    risks.push("Budget was not provided; affordability is unknown.");
  }

  if ((input.description ?? "").length > 180) {
    score += 10;
    reasons.push("Requirements text is long enough to interpret.");
  } else {
    risks.push("Requirements are short or missing; clarity is limited.");
  }

  if ((input.skills ?? []).length) {
    score += 8;
    reasons.push(`Listed skills: ${(input.skills ?? []).slice(0, 6).join(", ")}.`);
  }

  if (/urgent|asap|immediately/.test(text)) {
    score += 4;
    reasons.push("Urgency language is present in the listing text.");
  }

  score = Math.max(0, Math.min(100, score));
  const classification: FitClassification =
    score >= 80 ? "EXCELLENT" : score >= 62 ? "GOOD" : score >= 42 ? "MARGINAL" : "SKIP";

  const recommendedAction =
    classification === "SKIP"
      ? "Skip unless the operator has extra context not in the listing."
      : classification === "MARGINAL"
        ? "Review manually before drafting."
        : "Prepare a draft for human approval. Do not submit externally yet.";

  return {
    score,
    classification,
    reasons,
    risks,
    recommendedAction,
    recommendedService: service,
  };
}
