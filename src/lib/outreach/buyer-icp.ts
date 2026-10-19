/**
 * Outreach buyer filter driven by the active Business Profile (src/lib/business/profile.ts).
 * Target roles / industries / exclusions all come from the profile, so anyone can
 * configure who counts as a buyer. Agencies, tech peers, recruiters and juniors are
 * excluded only when the matching profile toggle is on (all on by default).
 */
import { compiledProfile, getBusinessProfile, profilePromptSummary } from "@/lib/business/profile";

export function buyerIcpNotes() {
  return profilePromptSummary();
}

/** Titles / roles we sell TO (from Business Profile → target roles). */
export function buyerRoleRe() {
  return compiledProfile().roles;
}

/** Digital / marketing / web agencies — competitors, not customers. Real-estate/insurance agencies are not this. */
export const COMPETITOR_AGENCY_RE =
  /\b((digital|marketing|web|seo|sem|ppc|branding|creative|ad|advertising|social media|growth|content|pr|design) agency|web studio|creative studio|media agency|agency owner|agency holder)\b/i;

const HR_RE =
  /\b(recruiter|recruiting|talent acquisition|talent partner|hr\b|human resources|hiring manager|people ops|people operations)\b/i;

const DESIGNER_RE =
  /\b(graphic designer|visual designer|social media designer|ui designer|ux designer|product designer|motion designer|illustrator|brand designer|creative designer|\bdesigner\b)\b/i;

/** Individual builders / tech practitioners — never pitch. */
const PEER_BUILDER_RE =
  /\b(software engineer|software developer|web developer|website developer|full[- ]?stack|frontend|front[- ]?end|backend|back[- ]?end|app developer|mobile developer|programmer|programming|coder|coding|devops|sre\b|ml engineer|machine learning engineer|data (engineer|scientist)|prompt engineer|llm engineer|ai engineer|ai developer|ai researcher|ai specialist|ai consultant|ai automation|automation (engineer|specialist|expert)|n8n|zapier|make\.com|chatbot (developer|engineer)|wordpress developer|shopify developer|next\.?js|react( native)?|node\.?js|python developer|javascript developer|typescript developer|golang|freelance (dev|developer|designer)|available for (hire|freelance)|\bdeveloper\b|\bengineer\b|\bcoder\b)\b/i;

/**
 * Software / AI / coding companies — even if the person is Founder/CEO.
 * Excluded when Business Profile → excludeTechCompanies is on.
 */
export const TECH_PEER_COMPANY_RE =
  /\b(software( company| house| agency| solutions| services| development| eng)?|saas|ai (company|startup|agency|lab|labs|solutions|services|product|platform)|artificial intelligence|machine learning|\bllm\b|chatgpt|openai|coding|coder|coders|programmer|it (company|services|solutions|consultancy|consulting|firm)|tech (company|startup|agency|firm|labs)|web (agency|studio|development|dev)|app (development|developer|agency|studio)|digital (agency|solutions|product|transformation)|fintech|edtech|healthtech|blockchain|web3|crypto|cyber ?security|cloud (native|computing|services)|data science|devops|full[- ]?stack|mobile app|react|node\.?js|python|javascript|typescript|golang|rust|devshop|dev shop|software house|product studio|engineering team|cto\b|chief technology|chief information|cis(o)?\b|\bcode\b|\bcodo\b|logix|infotech|softworks|techlabs|devlabs|hackathon|github)\b|(?:^|[|\s,/(-])IT(?:[|\s,/)-]|$)/i;

const JUNIOR_NON_BUYER_RE =
  /\b(intern|student|trainee|receptionist|coordinator|assistant|junior|graduate|apprentice|entry[- ]?level|job[- ]?seeker|open to work|looking for (a )?job)\b/i;

export type BuyerFit = {
  ok: boolean;
  code:
    | "BUYER"
    | "PEER_BUILDER_OR_DESIGNER"
    | "TECH_PEER_COMPANY"
    | "AGENCY_HOLDER"
    | "HR_OR_RECRUITER"
    | "NON_BUYER_ROLE"
    | "NO_BUYER_SIGNAL";
  reason: string;
};

/** LinkedIn search/connection cards often glue `Name • 1st Headline | Company` into one field. */
export function parseLinkedInCardIdentity(blob?: string | null) {
  const text = (blob ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { displayName: null as string | null, headline: null as string | null, company: null as string | null };
  const first = text.match(/^(.+?)\s+•\s+1st\s+(.+)$/i);
  const displayName = (first?.[1] ?? text.split(/\s+[•|]\s+/)[0] ?? text).trim() || null;
  const headline = (first?.[2] ?? text).trim() || null;
  const fromAt = headline?.match(/\bat\s+([^|•,]+)/i)?.[1]?.trim() ?? null;
  const fromRoleComma = headline?.match(
    /\b(?:founder|co-?founder|ceo|coo|owner|proprietor)[,:\-–]\s*([^|•]+)/i,
  )?.[1]?.trim() ?? null;
  const company = (fromAt || fromRoleComma || null)?.replace(/\s+/g, " ").trim() || null;
  return { displayName, headline, company };
}

/**
 * Agency / tech-peer / recruiter / junior exclusions from company, category, or title text.
 * Does not require a person's job title — company and category are enough.
 * Returns null when nothing in the Business Profile exclusions matches.
 */
export function listingExclusion(text: string): BuyerFit | null {
  const profile = getBusinessProfile();
  const compiled = compiledProfile(profile);
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (compiled.competitors.test(trimmed)) {
    return { ok: false, code: "AGENCY_HOLDER", reason: "Listed as a competitor in your Business Profile." };
  }
  if (compiled.exclude.test(trimmed)) {
    return { ok: false, code: "NON_BUYER_ROLE", reason: "Matches an exclude keyword in your Business Profile." };
  }
  if (profile.excludeTechCompanies && /coders|\bengineering\b/i.test(trimmed)) {
    return {
      ok: false,
      code: "TECH_PEER_COMPANY",
      reason:
        "Software / AI / IT / coding company. Do not connect or pitch tech companies — only non-tech businesses that need tech built for them.",
    };
  }
  if (profile.excludeAgencies && COMPETITOR_AGENCY_RE.test(trimmed)) {
    return {
      ok: false,
      code: "AGENCY_HOLDER",
      reason: "Digital / marketing / web agency — excluded by your Business Profile.",
    };
  }
  if (profile.excludeRecruiters && HR_RE.test(trimmed)) {
    return {
      ok: false,
      code: "HR_OR_RECRUITER",
      reason: "HR / recruiter — excluded by your Business Profile.",
    };
  }
  if (profile.excludeTechCompanies && (DESIGNER_RE.test(trimmed) || PEER_BUILDER_RE.test(trimmed))) {
    return {
      ok: false,
      code: "PEER_BUILDER_OR_DESIGNER",
      reason:
        "Software/AI/coding practitioner or designer. Do not connect or pitch peers who already build tech.",
    };
  }
  if (profile.excludeTechCompanies && TECH_PEER_COMPANY_RE.test(trimmed)) {
    return {
      ok: false,
      code: "TECH_PEER_COMPANY",
      reason:
        "Software / AI / IT / coding company. Do not connect or pitch tech companies — only non-tech businesses that need tech built for them.",
    };
  }
  if (profile.excludeJuniorRoles && JUNIOR_NON_BUYER_RE.test(trimmed)) {
    return {
      ok: false,
      code: "NON_BUYER_ROLE",
      reason: "Junior / non-decision-maker role.",
    };
  }
  return null;
}

export function classifyBuyerRole(
  roleOrHeadline?: string | null,
  company?: string | null,
): BuyerFit {
  const profile = getBusinessProfile();
  const compiled = compiledProfile(profile);
  const parsed = parseLinkedInCardIdentity(roleOrHeadline);
  const text = [roleOrHeadline, parsed.headline, parsed.company, company].filter(Boolean).join(" ").trim();
  if (!text) {
    return {
      ok: false,
      code: "NO_BUYER_SIGNAL",
      reason: "No role/headline. Do not pitch until we know they are a business buyer.",
    };
  }
  const excluded = listingExclusion(text);
  if (excluded) return excluded;
  if (compiled.roles.test(text) || profile.targetRoles.length === 0) {
    return {
      ok: true,
      code: "BUYER",
      reason: "Matches a target buyer role in your Business Profile.",
    };
  }
  return {
    ok: false,
    code: "NO_BUYER_SIGNAL",
    reason: "Not clearly a founder, owner, or industry business buyer. Skip.",
  };
}

/** Combined non-buyer matcher for simple `.test` call sites. */
export const NON_BUYER_ROLE_RE =
  /(?:recruiter|recruiting|talent acquisition|talent partner|\bhr\b|human resources|hiring manager|people ops|graphic designer|visual designer|social media designer|ui designer|ux designer|product designer|motion designer|illustrator|brand designer|creative designer|\bdesigner\b|software|saas|\bai\b|artificial intelligence|machine learning|llm|coding|coder|programmer|programming|it (?:company|services|solutions)|tech (?:company|startup|agency)|web (?:agency|studio|development)|app (?:development|agency)|digital agency|agency owner|agency holder|fintech|blockchain|web3|full[- ]?stack|frontend|backend|devops|\bdeveloper\b|\bengineer\b|intern|student|trainee|junior|graduate|job[- ]?seeker|open to work)/i;

export function isNonBuyerRole(roleOrHeadline?: string | null, company?: string | null) {
  return !classifyBuyerRole(roleOrHeadline, company).ok;
}
