/**
 * Pre-outreach filter: only contact people/businesses that match your Business Profile
 * (target roles / industries / locations, exclusions) AND show evidence they want your services.
 * Never invent demand to fill a daily cap.
 */
import {
  briefHasGeoConstraint,
  matchesCampaignGeo,
  type CampaignIntent,
} from "@/lib/campaigns/intent";
import { classifyBuyerRole, parseLinkedInCardIdentity } from "@/lib/outreach/buyer-icp";
import { compiledProfile, getBusinessProfile } from "@/lib/business/profile";

/** Operator-nominated rows (sheet / CSV / manual) — potential customers they already picked. */
export function isOperatorSheetSource(source?: string | null) {
  if (!source?.trim()) return false;
  return /\b(google-?sheets?(?:-browser)?|csv|manual|spreadsheet|workbook)\b/i.test(source);
}

/** Already-connected 1st-degree people Jarvis is allowed to pitch like sheet buyers. */
export function isConnectedPitchSource(source?: string | null) {
  if (isOperatorSheetSource(source)) return true;
  return /\blinkedin_connections_message\b/i.test(source ?? "");
}

/** Operator-picked people for a new LinkedIn invite — sheet/CSV/manual or buyer-connect search. */
export function isNominatedConnectionSource(source?: string | null) {
  if (isOperatorSheetSource(source)) return true;
  return /\blinkedin_connect_buyers\b/i.test(source ?? "");
}

/** Generic ask / hire language. Profile includeKeywords and services are matched too. */
export const SERVICE_NEED_RE =
  /\b(need|needs|looking for|looking to (hire|get|build|rebuild)|hire|hiring|want(s)? (a |an |to )?(website|web ?site|app|software|developer|agency|branding|seo|automation|ai|chatbot)|rebuild|redesign|no website|outdated (website|site)|broken (website|site)|help (with|building)|can (someone|anyone) (build|make|help)|recommend( a)? (developer|agency|freelancer)|moderni[sz]e|latest (tech|technology)|outdated (tech|stack|system))\b/i;


export type WantsOurServicesInput = {
  name?: string | null;
  company?: string | null;
  industry?: string | null;
  website?: string | null;
  location?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  roleTitle?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  source?: string | null;
  /** Latest Decision Maker serviceNeed.status */
  serviceNeedStatus?: string | null;
  /** Opportunity.selection PRIORITY | NURTURE | REJECT */
  opportunitySelection?: string | null;
  /**
   * LinkedIn/X: require a clear buyer role.
   * Email (Maps/company rows): allow non-tech business identity without a person title.
   */
  channel?: "EMAIL" | "LINKEDIN" | "X_TWITTER" | "OTHER";
  /**
   * Already a first-degree LinkedIn connection. Sheet-nominated non-tech buyers
   * may be pitched without hire-language on the row.
   */
  connectedMessage?: boolean;
  /**
   * Operator-nominated LinkedIn connection invite (sheet / buyer list).
   * Same demand skip as connected sheet pitch; agency/tech still blocked.
   */
  nominatedConnection?: boolean;
  /** When set with cities/regions, lead location must match. Empty → world OK. */
  campaignBrief?: CampaignIntent | null;
};

export type WantsOurServicesResult = {
  ok: boolean;
  code:
    | "WANTS_SERVICES"
    | "TECH_PEER"
    | "AGENCY_HOLDER"
    | "NOT_BUYER"
    | "NO_DEMAND_SIGNAL"
    | "REJECTED_OPPORTUNITY"
    | "WRONG_GEO"
    | "NOT_CONTACTABLE";
  reason: string;
};

function demandText(input: WantsOurServicesInput) {
  return [input.originalPost, input.notes, input.industry, input.company].filter(Boolean).join(" ");
}

function hasExplicitDemand(input: WantsOurServicesInput) {
  if (String(input.serviceNeedStatus ?? "").toUpperCase() === "PASS") return true;
  if (String(input.opportunitySelection ?? "").toUpperCase() === "PRIORITY") return true;
  const text = demandText(input);
  if (compiledProfile().include.test(text)) return true;
  if (SERVICE_NEED_RE.test(text)) return true;
  return false;
}

function isNonTechBusinessIdentity(input: WantsOurServicesInput) {
  const blob = [input.company, input.industry, input.website, input.notes].filter(Boolean).join(" ");
  if (!blob.trim()) return false;
  const buyer = classifyBuyerRole(input.roleTitle ?? input.name, input.company);
  if (buyer.code === "TECH_PEER_COMPANY" || buyer.code === "PEER_BUILDER_OR_DESIGNER") return false;
  if (compiledProfile().industries.test(blob)) return true;
  // Company + website and not a tech peer is a weak business identity (Maps-style).
  if (input.company?.trim() && input.website?.trim()) return true;
  return false;
}

function isNominatedBuyerPitch(input: WantsOurServicesInput) {
  if (Boolean(input.connectedMessage) && isConnectedPitchSource(input.source)) return true;
  if (Boolean(input.nominatedConnection) && isNominatedConnectionSource(input.source)) return true;
  return false;
}

function isContactable(input: WantsOurServicesInput): boolean {
  const channel = input.channel ?? "OTHER";
  if (channel === "EMAIL") return Boolean(input.email?.trim());
  if (channel === "LINKEDIN") return Boolean(input.linkedinUrl?.trim());
  if (channel === "X_TWITTER") return Boolean(input.twitterUrl?.trim());
  return Boolean(input.email?.trim() || input.linkedinUrl?.trim() || input.twitterUrl?.trim());
}

/**
 * Shared gate for home email / LinkedIn / X before send.
 * Buyer (or non-tech business) + demand evidence + optional brief geo + contactable.
 * No demand → no outreach.
 */
export function wantsOurServices(input: WantsOurServicesInput): WantsOurServicesResult {
  if (String(input.opportunitySelection ?? "").toUpperCase() === "REJECT") {
    return {
      ok: false,
      code: "REJECTED_OPPORTUNITY",
      reason: "Opportunity is REJECT — do not outreach.",
    };
  }

  const parsed = parseLinkedInCardIdentity(input.name);
  const buyer = classifyBuyerRole(
    [input.roleTitle, parsed.headline, parsed.displayName].filter(Boolean).join(" ") || input.name,
    input.company ?? parsed.company,
  );
  if (buyer.code === "AGENCY_HOLDER") {
    return {
      ok: false,
      code: "AGENCY_HOLDER",
      reason: buyer.reason,
    };
  }
  if (buyer.code === "TECH_PEER_COMPANY" || buyer.code === "PEER_BUILDER_OR_DESIGNER" || buyer.code === "HR_OR_RECRUITER") {
    return {
      ok: false,
      code: "TECH_PEER",
      reason: buyer.reason,
    };
  }

  const channel = input.channel ?? "OTHER";
  const personChannel = channel === "LINKEDIN" || channel === "X_TWITTER";
  if (personChannel) {
    if (!buyer.ok) {
      // Nominated sheet/buyer-list: company helps, but a person name is enough
      // when the row is operator-picked and not agency/tech.
      const nominated =
        isNominatedBuyerPitch(input) &&
        (isNonTechBusinessIdentity(input) ||
          Boolean(input.company?.trim() || parsed.company) ||
          Boolean(input.name?.trim() || parsed.displayName));
      if (!nominated) {
        return {
          ok: false,
          code: "NOT_BUYER",
          reason: buyer.reason,
        };
      }
    }
  } else if (channel === "EMAIL") {
    // Maps/email rows often lack a person title — require non-tech business identity.
    if (!buyer.ok && !isNonTechBusinessIdentity(input)) {
      return {
        ok: false,
        code: "NOT_BUYER",
        reason: "Not a clear buyer for your services (see Business Profile).",
      };
    }
  } else if (!buyer.ok && !isNonTechBusinessIdentity(input)) {
    return {
      ok: false,
      code: "NOT_BUYER",
      reason: buyer.reason,
    };
  }

  if (getBusinessProfile().requireDemandSignal && !hasExplicitDemand(input)) {
    const nominatedPitch =
      isNominatedBuyerPitch(input) &&
      (buyer.ok ||
        isNonTechBusinessIdentity(input) ||
        Boolean(input.company?.trim() || parsed.company) ||
        Boolean(input.name?.trim() || parsed.displayName));
    if (!nominatedPitch) {
      return {
        ok: false,
        code: "NO_DEMAND_SIGNAL",
        reason:
          "No evidence they want your services (no service-need PASS, PRIORITY, or need/include-keyword language).",
      };
    }
  }

  const profile = getBusinessProfile();
  if (profile.targetLocations.length > 0 && !briefHasGeoConstraint(input.campaignBrief)) {
    const blob = [input.location, input.notes, input.company].filter(Boolean).join(" ");
    if (!compiledProfile(profile).locations.test(blob)) {
      return {
        ok: false,
        code: "WRONG_GEO",
        reason: "Lead location is not in your Business Profile target locations.",
      };
    }
  }

  if (briefHasGeoConstraint(input.campaignBrief)) {
    const geoOk = matchesCampaignGeo(input.location, input.campaignBrief, [
      input.notes,
      input.company,
      input.industry,
    ].filter(Boolean).join(" "));
    if (!geoOk) {
      return {
        ok: false,
        code: "WRONG_GEO",
        reason: "Lead location does not match campaign brief cities/regions.",
      };
    }
  }

  if (!isContactable(input)) {
    return {
      ok: false,
      code: "NOT_CONTACTABLE",
      reason:
        channel === "EMAIL"
          ? "No email on file."
          : channel === "LINKEDIN"
            ? "No LinkedIn URL on file."
            : channel === "X_TWITTER"
              ? "No X/Twitter URL on file."
              : "No contact channel on file.",
    };
  }

  return {
    ok: true,
    code: "WANTS_SERVICES",
    reason: "Buyer fit + demand signal for your services.",
  };
}
