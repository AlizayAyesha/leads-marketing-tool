import { getBusinessProfile } from "@/lib/business/profile";
import type { FitClassification, ZarService } from "@prisma/client";

import { inferService, parseBudgetAmount } from "@/lib/platforms/qualify-core";
import { zarServiceForOffer, type OfferFamily } from "@/lib/intelligence/offers";

export type FiverrBand = "RESPOND" | "REVIEW" | "HOLD" | "REJECT";

export type FiverrQualifyInput = {
  title?: string | null;
  message: string;
  budget?: string | null;
  budgetAmount?: number | null;
  buyerName?: string | null;
  location?: string | null;
};

export type FiverrQualification = {
  total: number;
  band: FiverrBand;
  classification: FitClassification;
  breakdown: {
    projectFit: number;
    buyerIntent: number;
    budget: number;
    complexity: number;
    capability: number;
    buyerQuality: number;
  };
  reasons: string[];
  risks: string[];
  recommendedService: ZarService | null;
  offerFamily: OfferFamily | null;
  recommendedAction: string;
};

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function offerFromService(service: ZarService | null): OfferFamily | null {
  if (!service) return null;
  if (service === "AI_INTEGRATION" || service === "AI_CHATBOTS") return "AI_ARCHITECTURE";
  if (service === "BRANDING" || service === "UI_UX") return "AI_VIDEO_ADS";
  if (service === "AI_AUTOMATION" || service === "CRM_ERP_DEVELOPMENT") return "AUTOMATION";
  if (service === "WEBSITE_DEVELOPMENT" || service === "FULL_STACK_DEVELOPMENT" || service === "SAAS_DEVELOPMENT" || service === "CUSTOM_SOFTWARE") {
    return "WEB_SOFTWARE";
  }
  return null;
}

export function fiverrBandFromTotal(total: number): FiverrBand {
  if (total >= 80) return "RESPOND";
  if (total >= 65) return "REVIEW";
  if (total >= 50) return "HOLD";
  return "REJECT";
}

export function classificationFromBand(band: FiverrBand): FitClassification {
  if (band === "RESPOND") return "EXCELLENT";
  if (band === "REVIEW") return "GOOD";
  if (band === "HOLD") return "MARGINAL";
  return "SKIP";
}

export function qualifyFiverrRequest(input: FiverrQualifyInput): FiverrQualification {
  const reasons: string[] = [];
  const risks: string[] = [];
  const hay = `${input.title ?? ""} ${input.message}`.toLowerCase();
  const service = inferService(hay);
  const family = offerFromService(service);

  let projectFit = 4;
  if (service) {
    projectFit += 14;
    reasons.push(`Observed fit: ${service.replaceAll("_", " ").toLowerCase()}.`);
  } else {
    risks.push("No your business service keyword in the request.");
  }
  if (/\b(whatsapp|hubspot|crm|real estate|lead qualif|sales agent)\b/i.test(hay)) {
    projectFit += 7;
    reasons.push("Niche problem language (ops/CRM/WhatsApp/sales), not a generic gig browse.");
  }
  projectFit = clamp(projectFit, 25);

  let buyerIntent = 4;
  if ((input.message ?? "").trim().length > 180) {
    buyerIntent += 8;
    reasons.push("Request is long enough to interpret.");
  } else {
    risks.push("Request is short; intent is weak.");
  }
  if (/\b(need|looking for|want you to|build|integrate|automate)\b/i.test(hay)) buyerIntent += 5;
  if (/\b(urgent|asap|this week)\b/i.test(hay)) buyerIntent += 3;
  buyerIntent = clamp(buyerIntent, 20);

  const amount = input.budgetAmount ?? parseBudgetAmount(input.budget) ?? parseBudgetAmount(input.message);
  let budget = 3;
  if (amount == null) {
    risks.push("Budget not stated.");
  } else if (amount < 80) {
    budget = 0;
    risks.push(`Budget ${amount} is a micro-gig — reject for ${getBusinessProfile().businessName} delivery.`);
  } else if (amount < 400) {
    budget = 4;
    risks.push("Budget is low for custom software.");
  } else if (amount >= 1000) {
    budget = 15;
    reasons.push(`Budget ${amount} is in a custom-work range.`);
  } else {
    budget = 9;
    reasons.push(`Budget ${amount} was provided.`);
  }
  budget = clamp(budget, 15);

  let complexity = 3;
  if (/\b(integrat|hubspot|whatsapp|crm|multi-agent|rag|workflow)\b/i.test(hay)) {
    complexity += 8;
    reasons.push("Integration / ops complexity is described.");
  }
  if (/\b(fix my html|change color|logo only|one page tweak)\b/i.test(hay)) {
    complexity = 2;
    risks.push("Tiny tweak work — poor use of your business time.");
  }
  if (amount != null && amount >= 1500) complexity += 4;
  complexity = clamp(complexity, 15);

  let capability = service ? 12 : 3;
  if (family) {
    capability = 15;
    reasons.push(`Maps to ${family.replaceAll("_", " ")}.`);
  } else {
    risks.push("Capability match is unclear.");
  }
  capability = clamp(capability, 15);

  let buyerQuality = 2;
  if (input.buyerName?.trim()) buyerQuality += 3;
  if (input.location?.trim()) buyerQuality += 2;
  if (!/\b(student|assignment|homework)\b/i.test(hay)) buyerQuality += 3;
  else risks.push("Looks like student/assignment work.");
  buyerQuality = clamp(buyerQuality, 10);

  if (amount != null && amount < 80) {
    return {
      total: 12,
      band: "REJECT",
      classification: "SKIP",
      breakdown: { projectFit, buyerIntent, budget, complexity, capability, buyerQuality },
      reasons,
      risks,
      recommendedService: service,
      offerFamily: family,
      recommendedAction: "REJECT — micro-gig. Do not draft a proposal.",
    };
  }

  const total = projectFit + buyerIntent + budget + complexity + capability + buyerQuality;
  const band = fiverrBandFromTotal(total);
  const action =
    band === "RESPOND"
      ? "RESPOND — draft a specific reply for human approval."
      : band === "REVIEW"
        ? "REVIEW — draft only if the operator still wants this buyer."
        : band === "HOLD"
          ? "HOLD — do not draft until budget/scope is clearer."
          : "REJECT — do not spend a proposal slot.";

  return {
    total,
    band,
    classification: classificationFromBand(band),
    breakdown: { projectFit, buyerIntent, budget, complexity, capability, buyerQuality },
    reasons,
    risks,
    recommendedService: family ? zarServiceForOffer(family) : service,
    offerFamily: family,
    recommendedAction: action,
  };
}

export function canDraftFiverrResponse(band: FiverrBand) {
  return band === "RESPOND" || band === "REVIEW";
}
