import type { LeadSignals } from "@/lib/intelligence/signals";
import type { EvidenceType } from "@/lib/intelligence/evidence";

export type DetectedOpportunity = {
  problem: string;
  opportunity: string;
  opportunityKey: string;
  evidence: string;
  confidence: EvidenceType;
  potentialImpact: "LOW" | "MEDIUM" | "HIGH";
};

/**
 * Problem first. Keywords such as AI / software / automation are not an opportunity.
 * A weak public website is not, by itself, a reason to sell a rebuild.
 */
export function detectOpportunity(signals: LeadSignals, originalPost?: string | null): DetectedOpportunity {
  const source = originalPost?.trim() ?? "";

  if (signals.keyword_only) {
    return unknown(
      "Buzzwords are present without a stated problem or operational evidence.",
      "Keyword mentions of AI/software/automation are not a business opportunity.",
    );
  }

  if (signals.explicit_request && source) {
    const key = keyFromRequest(signals, source);
    return {
      problem: `The source text states a need: ${source.slice(0, 180)}`,
      opportunity: key,
      opportunityKey: key,
      evidence: source.slice(0, 280),
      confidence: "FACT",
      potentialImpact: "HIGH",
    };
  }

  if (signals.explicit_request && signals.operational_complexity) {
    const key = keyFromRequest(signals, "");
    return {
      problem: "An explicit request plus operational complexity is present in the lead record.",
      opportunity: key,
      opportunityKey: key,
      evidence: "explicit_request=true; operational_complexity=true",
      confidence: "FACT",
      potentialImpact: "HIGH",
    };
  }

  if (signals.operational_complexity && (signals.website_exists || signals.mentions_software)) {
    const key = keyFromRequest(signals, "");
    return {
      problem: "Operational complexity is described. Whether they want outside help is not confirmed.",
      opportunity: key,
      opportunityKey: key,
      evidence: "operational_complexity described in notes/post; no explicit buying request.",
      confidence: "INFERENCE",
      potentialImpact: "MEDIUM",
    };
  }

  if (signals.thin_record || !signals.website_exists) {
    return unknown(
      "Not enough public information to name a business problem.",
      "Insufficient public evidence.",
    );
  }

  return unknown(
    "No stated request and no operational evidence. A public website or keyword is not a problem.",
    "No explicit request and no operational complexity signal.",
  );
}

function keyFromRequest(signals: LeadSignals, source: string) {
  const hay = source.toLowerCase();
  if (/agentic|multi-agent|ticket routing across/.test(hay) || (/agentic/.test(hay) && /workflow/.test(hay))) {
    return "agentic_workflow";
  }
  if (/workflow automation|\binvoice|\bautomat|zapier|n8n/.test(hay) || (signals.mentions_automation && !/internal tool|custom software|web application/.test(hay))) {
    return "workflow_automation";
  }
  if (/custom (software|system)|internal tool|inventory/.test(hay)) {
    return "custom_software";
  }
  if (/web app|web application|customer onboarding/.test(hay)) {
    return "web_application";
  }
  if (signals.mentions_website_need || /website|landing page|rebuild|brochure/.test(hay)) {
    return "website_modernization";
  }
  if (signals.operational_complexity) return "custom_software";
  return "stated_request";
}

function unknown(problem: string, evidence: string): DetectedOpportunity {
  return {
    problem,
    opportunity: "unknown",
    opportunityKey: "unknown",
    evidence,
    confidence: "UNKNOWN",
    potentialImpact: "LOW",
  };
}
