import type { OfferFamily } from "@/lib/intelligence/offers";

export type OfferMatrixRow = {
  id: string;
  signal: string;
  problem: string;
  technologyOpportunity: string;
  ourSolution: string;
  specificOffer: string;
  cta: string;
  offerFamily: OfferFamily;
  test: (input: {
    ads?: boolean;
    weakLanding?: boolean;
    noBooking?: boolean;
    whatsapp?: boolean;
    multipleLocations?: boolean;
    outdatedWebsite?: boolean;
    hiring?: boolean;
    opsComplexity?: boolean;
  }) => boolean;
};

export const OFFER_MATRIX: OfferMatrixRow[] = [
  {
    id: "ads_weak_landing",
    signal: "Paid ads + weak landing experience",
    problem: "Conversion leakage",
    technologyOpportunity: "Landing / CRO opportunity",
    ourSolution: "AI ads + landing optimization",
    specificOffer: "AI landing + CRO",
    cta: "Worth sending you a 2-minute concept on the landing leak?",
    offerFamily: "AI_VIDEO_ADS",
    test: (s) => Boolean(s.ads && s.weakLanding),
  },
  {
    id: "manual_inquiry",
    signal: "Manual inquiry / generic form / WhatsApp intake",
    problem: "Slow qualification",
    technologyOpportunity: "Automate lead intake",
    ourSolution: "AI qualification + CRM",
    specificOffer: "AI Sales / Lead Qualification System",
    cta: "Worth sending you a 2-minute concept for inquiry qualification?",
    offerFamily: "AUTOMATION",
    test: (s) => Boolean(s.noBooking || s.whatsapp || (s.weakLanding && !s.ads)),
  },
  {
    id: "multi_location",
    signal: "Multiple locations + fragmented operations",
    problem: "Operational complexity",
    technologyOpportunity: "Centralized workflow",
    ourSolution: "CRM / automation / dashboard",
    specificOffer: "Operations workflow map + dashboard",
    cta: "Worth sending a 2-minute workflow map?",
    offerFamily: "AI_ARCHITECTURE",
    test: (s) => Boolean(s.multipleLocations || s.opsComplexity),
  },
  {
    id: "brand_site_gap",
    signal: "Premium positioning + outdated site",
    problem: "Brand / digital mismatch",
    technologyOpportunity: "Premium website rebuild",
    ourSolution: "Luxury / high-ticket website",
    specificOffer: "Premium website",
    cta: "Worth a 2-minute look at the site gap?",
    offerFamily: "WEB_SOFTWARE",
    test: (s) => Boolean(s.outdatedWebsite),
  },
  {
    id: "growing_team",
    signal: "Growing team / hiring ops or marketing",
    problem: "Repetitive internal work",
    technologyOpportunity: "Internal AI employee",
    ourSolution: "AI employee / workflow automation",
    specificOffer: "AI employee for repetitive ops",
    cta: "Worth a 2-minute concept for the ops load?",
    offerFamily: "AUTOMATION",
    test: (s) => Boolean(s.hiring),
  },
];

export function matchOfferMatrix(input: Parameters<OfferMatrixRow["test"]>[0]): OfferMatrixRow | null {
  return OFFER_MATRIX.find((row) => row.test(input)) ?? null;
}
