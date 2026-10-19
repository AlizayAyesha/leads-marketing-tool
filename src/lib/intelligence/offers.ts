/**
 * your business commercial offer families. Outreach uses ONE primary offer.
 * Existing ZarService enum stays for storage; families are the operator-facing match.
 */
import type { ZarService } from "@prisma/client";

export const OFFER_FAMILIES = ["GRAPHICS", "WEB_SOFTWARE", "AUTOMATION", "AI_ARCHITECTURE", "AI_VIDEO_ADS"] as const;
export type OfferFamily = (typeof OFFER_FAMILIES)[number];

export const OUTREACH_ANGLES = [
  "CREATIVE_SCALABILITY",
  "AD_PERFORMANCE",
  "COST_REDUCTION",
  "OPERATIONAL_EFFICIENCY",
  "AI_TRANSFORMATION",
  "CUSTOMER_EXPERIENCE",
  "LEAD_FOLLOWUP",
  "DIGITAL_CONVERSION",
  "PRODUCT_LAUNCH",
] as const;
export type OutreachAngle = (typeof OUTREACH_ANGLES)[number];

export const OFFER_LABEL: Record<OfferFamily, string> = {
  GRAPHICS: "Graphics & branding",
  WEB_SOFTWARE: "Web development",
  AUTOMATION: "Automation",
  AI_ARCHITECTURE: "AI architecture",
  AI_VIDEO_ADS: "AI ads & UGC video",
};

export const OFFER_BRIEF: Record<OfferFamily, string> = {
  GRAPHICS: "Identity, visual system, and on-brand graphics for a high-ticket company.",
  WEB_SOFTWARE: "Marketing site, booking, or conversion rebuild — not a vanity redesign.",
  AUTOMATION: "WhatsApp, CRM, follow-up, and ops workflows that are still manual.",
  AI_ARCHITECTURE: "Custom AI / software architecture inside their operation (not a chatbot gimmick).",
  AI_VIDEO_ADS: "AI advertising and UGC-style video for paid social, launches, and listings.",
};

export type OfferScores = Record<OfferFamily, number>;

export type OfferMatch = {
  scores: OfferScores;
  primary: OfferFamily;
  secondary: OfferFamily | null;
  angle: OutreachAngle;
  zarService: ZarService;
};

export function zarServiceForOffer(offer: OfferFamily): ZarService {
  if (offer === "GRAPHICS") return "BRANDING";
  if (offer === "AI_ARCHITECTURE") return "AI_INTEGRATION";
  if (offer === "AI_VIDEO_ADS") return "BRANDING";
  if (offer === "AUTOMATION") return "AI_AUTOMATION";
  return "WEBSITE_DEVELOPMENT";
}

export function emptyOfferScores(): OfferScores {
  return { GRAPHICS: 0, WEB_SOFTWARE: 0, AUTOMATION: 0, AI_ARCHITECTURE: 0, AI_VIDEO_ADS: 0 };
}

export function pickPrimarySecondary(scores: OfferScores): { primary: OfferFamily; secondary: OfferFamily | null } {
  const ranked = OFFER_FAMILIES.slice().sort((a, b) => scores[b] - scores[a]);
  const primary = ranked[0]!;
  const second = ranked[1]!;
  const secondary = scores[second] >= 60 && second !== primary ? second : null;
  return { primary, secondary };
}

export function angleForOffer(offer: OfferFamily, input: { launch?: boolean; ads?: boolean }): OutreachAngle {
  if (offer === "AI_VIDEO_ADS") {
    if (input.launch) return "PRODUCT_LAUNCH";
    if (input.ads) return "CREATIVE_SCALABILITY";
    return "AD_PERFORMANCE";
  }
  if (offer === "GRAPHICS") return "CREATIVE_SCALABILITY";
  if (offer === "AI_ARCHITECTURE") return "AI_TRANSFORMATION";
  if (offer === "AUTOMATION") return "LEAD_FOLLOWUP";
  return "DIGITAL_CONVERSION";
}

export function describePitch(offer: OfferMatch) {
  const lead = OFFER_LABEL[offer.primary];
  const backup = offer.secondary ? OFFER_LABEL[offer.secondary] : null;
  const brief = OFFER_BRIEF[offer.primary];
  return backup ? `Pitch ${lead} (backup: ${backup}). ${brief}` : `Pitch ${lead}. ${brief}`;
}
