import { getBusinessProfile } from "@/lib/business/profile";
import type { OutreachChannel } from "@prisma/client";

import { extractSignals } from "@/lib/intelligence/signals";
import { detectOpportunity } from "@/lib/intelligence/opportunity";
import { linkedinResearchToAuditPayload } from "@/lib/linkedin/evidence";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { instagramResearchToAuditPayload } from "@/lib/instagram/evidence";
import { inspectInstagramUrl } from "@/lib/instagram/url";
import { inspectTwitterUrl } from "@/lib/twitter/url";
import { matchTwitterServiceIntent } from "@/lib/twitter/intent-queries";
import { safeHost } from "@/lib/utils";

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_PRESENT";
export type AuditVerdict = "PASS" | "HOLD" | "REJECT";
export type ProfessionalStatus = "PROFESSIONAL" | "CONSUMER" | "UNKNOWN";
export type LinkedInSeniority = "established" | "newbie" | "unknown" | "not_present";
export type InstagramPresence = "professional" | "personal" | "unknown" | "not_present";

export type ChannelCheck = {
  status: CheckStatus;
  summary: string;
  evidence: string[];
  issues: string[];
};

export type LeadAuditInput = {
  name?: string | null;
  company?: string | null;
  website?: string | null;
  websiteHost?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  twitterUrl?: string | null;
  industry?: string | null;
  location?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  source?: string | null;
  rawPayload?: unknown;
  qualificationDecision?: string | null;
  qualificationScore?: number | null;
  linkedinResearch?: {
    status?: string | null;
    headline?: string | null;
    about?: string | null;
    roleTitle?: string | null;
    currentCompany?: string | null;
    publicSignals?: unknown;
  } | null;
  instagramResearch?: {
    status?: string | null;
    bio?: string | null;
    professionalCategory?: string | null;
    publicBusinessInfo?: string | null;
    website?: string | null;
    publicSignals?: unknown;
  } | null;
};

export type LeadAuditResult = {
  verdict: AuditVerdict;
  professional: ProfessionalStatus;
  email: ChannelCheck;
  linkedin: ChannelCheck & { seniority: LinkedInSeniority; urlKind: string };
  instagram: ChannelCheck & { presence: InstagramPresence };
  serviceNeed: ChannelCheck;
  allowedChannels: OutreachChannel[];
  blockers: string[];
  unknowns: string[];
  recommendedAction: string;
  reason: string;
  evidenceUsed: string[];
};

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "throwaway.email",
  "yopmail.com",
  "trashmail.com",
  "temp-mail.org",
]);

const PLACEHOLDER_LOCAL = /^(test|asdf|abc|noreply|no-reply|n\/a|na|fake|user|email)$/i;
const ROLE_LOCAL = /^(info|hello|contact|support|sales|admin|office|team|hi)$/i;
const NEWBIE_RE =
  /\b(intern|internship|student|undergraduate|freshman|sophomore|looking for (my )?first (job|role)|bootcamp student|class of 20(2[5-9]|3\d))\b/i;
const TITLE_RE =
  /\b(founder|co-founder|ceo|cto|cmo|owner|director|head of|vp|vice president|principal|partner|manager|lead|consultant|specialist)\b/i;
const BUSINESS_RE =
  /\b(agency|studio|clinic|practice|llc|ltd|inc|gmbh|company|official|services|consulting|boutique|salon|firm|shop|store|restaurant|hotel|real estate|architect|lawyer|attorney|dentist|doctor)\b/i;
const PERSONAL_BIO_RE =
  /\b(love travel|just a girl|just a boy|mom of|dad of|here for the vibes|dm for collab fun)\b/i;
const SERVICE_NEED_RE =
  /\b(need|needs|looking for|hire|hiring|want(s)? (a |to )?(website|app|developer|agency|branding|seo|automation)|rebuild|redesign|no website)\b/i;

function clip(value: string, max = 160) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function pickBool(record: Record<string, unknown> | null, keys: string[]): boolean | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function emailParts(email?: string | null) {
  const value = email?.trim().toLowerCase() ?? "";
  const match = value.match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
  if (!match) return null;
  return { local: match[1], domain: match[2] };
}

function auditEmail(input: LeadAuditInput): ChannelCheck {
  const evidence: string[] = [];
  const issues: string[] = [];
  if (!input.email?.trim()) {
    return {
      status: "NOT_PRESENT",
      summary: "No email on the lead record.",
      evidence,
      issues: ["Email is missing."],
    };
  }

  const parts = emailParts(input.email);
  if (!parts) {
    issues.push("Email is not a valid address.");
    return {
      status: "FAIL",
      summary: "Stored email is not a usable address.",
      evidence: [clip(input.email)],
      issues,
    };
  }

  evidence.push(`local=${parts.local}`);
  const websiteHost = (input.websiteHost || safeHost(input.website) || "").toLowerCase();
  if (DISPOSABLE_DOMAINS.has(parts.domain) || PLACEHOLDER_LOCAL.test(parts.local) || /example\.com$/.test(parts.domain)) {
    issues.push("Email looks disposable, placeholder, or example-only.");
    return {
      status: "FAIL",
      summary: "Email is not a real professional inbox.",
      evidence,
      issues,
    };
  }
  if (/(linkedin|instagram|facebook|twitter)\.com$/.test(parts.domain)) {
    issues.push("A social URL was stored as an email.");
    return { status: "FAIL", summary: "Email field holds a social domain, not an inbox.", evidence, issues };
  }
  if (websiteHost && parts.domain === websiteHost) {
    evidence.push(`matches website ${websiteHost}`);
    return {
      status: "PASS",
      summary: ROLE_LOCAL.test(parts.local)
        ? "Company-domain inbox (role address). Usable for outreach."
        : "Email domain matches the company website.",
      evidence,
      issues,
    };
  }
  if (websiteHost && /gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com/.test(parts.domain)) {
    evidence.push(`personal mailbox on ${parts.domain}; website is ${websiteHost}`);
    return {
      status: "PASS",
      summary: "Personal mailbox. Usable, but it is not a company-domain proof.",
      evidence,
      issues,
    };
  }
  if (websiteHost && parts.domain !== websiteHost) {
    issues.push(`Email domain ${parts.domain} does not match website ${websiteHost}.`);
    return {
      status: "UNKNOWN",
      summary: "Email format is valid, but it does not match the website domain.",
      evidence,
      issues,
    };
  }
  return {
    status: "PASS",
    summary: "Email format is valid. Company-domain alignment is unknown because no website is stored.",
    evidence,
    issues,
  };
}

function auditLinkedIn(input: LeadAuditInput, payload: Record<string, unknown> | null) {
  const url = inspectLinkedInUrl(input.linkedinUrl);
  const evidence: string[] = [];
  const issues: string[] = [];
  if (url.kind === "missing") {
    return {
      status: "NOT_PRESENT" as CheckStatus,
      seniority: "not_present" as LinkedInSeniority,
      urlKind: url.kind,
      summary: "No LinkedIn URL on the lead record.",
      evidence,
      issues: ["LinkedIn is missing."],
    };
  }
  if (url.kind === "invalid" || url.kind === "wrong_host") {
    issues.push(`URL host is ${url.host}, not LinkedIn.`);
    return {
      status: "FAIL" as CheckStatus,
      seniority: "unknown" as LinkedInSeniority,
      urlKind: url.kind,
      summary: "Stored LinkedIn value is not a LinkedIn URL.",
      evidence: [clip(input.linkedinUrl ?? "")],
      issues,
    };
  }
  if (url.kind === "not_profile") {
    issues.push("URL is a LinkedIn search/feed/jobs page, not a profile.");
    return {
      status: "FAIL" as CheckStatus,
      seniority: "unknown" as LinkedInSeniority,
      urlKind: url.kind,
      summary: "LinkedIn URL is not a person or company profile.",
      evidence: [clip(input.linkedinUrl ?? "")],
      issues,
    };
  }

  evidence.push(`url_kind=${url.kind}`);
  const headline = pickString(payload, ["headline", "occupation", "jobTitle", "title", "currentTitle"]);
  const about = pickString(payload, ["about", "summary", "linkedinDescription", "description"]);
  const connections = pickNumber(payload, ["connections", "connectionsCount", "connectionCount"]);
  const followers = pickNumber(payload, ["followers", "followersCount", "followerCount"]);
  const experiences = payload?.experiences ?? payload?.experience ?? payload?.positions ?? payload?.jobs;
  const experienceCount = arrayLength(experiences);
  const years = pickNumber(payload, ["yearsOfExperience", "years_of_experience", "experienceYears"]);
  if (headline) evidence.push(`headline: ${clip(headline, 80)}`);
  if (experienceCount != null) evidence.push(`experience_rows=${experienceCount}`);
  if (connections != null) evidence.push(`connections=${connections}`);
  if (years != null) evidence.push(`years=${years}`);

  const hay = `${headline ?? ""} ${about ?? ""} ${input.notes ?? ""}`;
  let seniority: LinkedInSeniority = "unknown";
  if (url.kind === "company") seniority = "established";
  else if (NEWBIE_RE.test(hay) || (years != null && years < 2) || (experienceCount === 0 && !TITLE_RE.test(hay))) {
    seniority = "newbie";
  } else if (
    TITLE_RE.test(hay) ||
    (years != null && years >= 2) ||
    (experienceCount != null && experienceCount >= 2) ||
    (connections != null && connections >= 200)
  ) {
    seniority = "established";
  } else if (followers != null && followers >= 500 && TITLE_RE.test(hay)) {
    seniority = "established";
  }

  if (url.kind === "school") {
    issues.push("URL is a school page, not a working professional profile.");
    seniority = seniority === "established" ? seniority : "newbie";
  }
  if (seniority === "unknown") {
    issues.push("Profile URL looks valid, but stored actor data does not prove seniority.");
  }
  if (seniority === "newbie") issues.push("LinkedIn evidence looks early-career / student, not an established buyer.");

  const status: CheckStatus =
    url.kind === "person" || url.kind === "company"
      ? seniority === "newbie"
        ? "FAIL"
        : seniority === "established"
          ? "PASS"
          : "UNKNOWN"
      : "UNKNOWN";

  return {
    status,
    seniority,
    urlKind: url.kind,
    summary:
      seniority === "established"
        ? "LinkedIn looks like an established professional or company page."
        : seniority === "newbie"
          ? "LinkedIn looks like a newbie / student profile."
          : "LinkedIn URL is plausible. Seniority is unproven from stored data.",
    evidence,
    issues,
  };
}

function auditInstagram(input: LeadAuditInput, payload: Record<string, unknown> | null) {
  const url = inspectInstagramUrl(input.instagramUrl);
  const evidence: string[] = [];
  const issues: string[] = [];
  if (url.kind === "missing") {
    return {
      status: "NOT_PRESENT" as CheckStatus,
      presence: "not_present" as InstagramPresence,
      summary: "No Instagram URL on the lead record.",
      evidence,
      issues: ["Instagram is missing."],
    };
  }
  if (url.kind === "wrong_host" || url.kind === "invalid") {
    issues.push(`URL host is ${url.host}, not Instagram.`);
    return {
      status: "FAIL" as CheckStatus,
      presence: "unknown" as InstagramPresence,
      summary: "Stored Instagram value is not an Instagram URL.",
      evidence: [clip(input.instagramUrl ?? "")],
      issues,
    };
  }
  if (url.kind === "not_profile") {
    issues.push("URL is a post/reel/explore page, not a profile.");
    return {
      status: "FAIL" as CheckStatus,
      presence: "unknown" as InstagramPresence,
      summary: "Instagram URL is not a profile.",
      evidence: [clip(input.instagramUrl ?? "")],
      issues,
    };
  }

  const bio = pickString(payload, ["biography", "bio", "ownerBiography", "about"]);
  const category = pickString(payload, ["businessCategoryName", "business_category_name", "categoryName", "category"]);
  const isBusiness =
    pickBool(payload, ["isBusinessAccount", "is_business_account", "isProfessionalAccount", "is_professional_account"]) ??
    false;
  const followers = pickNumber(payload, ["followersCount", "followers_count", "edge_followed_by", "followers"]);
  if (bio) evidence.push(`bio: ${clip(bio, 90)}`);
  if (category) evidence.push(`category: ${clip(category, 40)}`);
  if (isBusiness) evidence.push("business_or_professional_account=true");
  if (followers != null) evidence.push(`followers=${followers}`);

  const hay = `${bio ?? ""} ${category ?? ""} ${input.notes ?? ""} ${input.originalPost ?? ""} ${input.company ?? ""}`;
  let presence: InstagramPresence = "unknown";
  if (isBusiness || category || BUSINESS_RE.test(hay) || TITLE_RE.test(hay)) presence = "professional";
  else if (PERSONAL_BIO_RE.test(hay) && !input.company) presence = "personal";
  else if (bio && !BUSINESS_RE.test(hay) && !input.company && !input.website) presence = "personal";

  if (presence === "unknown") issues.push("Profile URL looks valid. Bio/business flags were not stored, so professionalism is unproven.");
  if (presence === "personal") issues.push("Instagram looks personal, not a professional/business presence.");

  const status: CheckStatus =
    presence === "professional" ? "PASS" : presence === "personal" ? "FAIL" : "UNKNOWN";

  return {
    status,
    presence,
    summary:
      presence === "professional"
        ? "Instagram bio/account flags look professional."
        : presence === "personal"
          ? "Instagram looks personal rather than a business presence."
          : "Instagram URL is plausible. Professionalism is unproven from stored posts/bio.",
    evidence,
    issues,
  };
}

function auditProfessional(input: LeadAuditInput, linkedin: LeadAuditResult["linkedin"], instagram: LeadAuditResult["instagram"]): ProfessionalStatus {
  if (linkedin.seniority === "established" || instagram.presence === "professional") return "PROFESSIONAL";
  if (input.company && (input.website || input.industry || TITLE_RE.test(`${input.notes ?? ""} ${input.originalPost ?? ""}`))) {
    return "PROFESSIONAL";
  }
  if (input.company && input.website) return "PROFESSIONAL";
  if (linkedin.seniority === "newbie" && !input.company && !input.website) return "CONSUMER";
  if (instagram.presence === "personal" && !input.company && !input.website) return "CONSUMER";
  if (!input.company && !input.website && !input.industry && linkedin.status === "NOT_PRESENT") return "UNKNOWN";
  if (input.company || input.website || input.industry) return "PROFESSIONAL";
  return "UNKNOWN";
}

function auditServiceNeed(input: LeadAuditInput): ChannelCheck {
  const signals = extractSignals({
    website: input.website,
    email: input.email,
    linkedinUrl: input.linkedinUrl,
    instagramUrl: input.instagramUrl,
    industry: input.industry,
    location: input.location,
    originalPost: input.originalPost,
    notes: input.notes,
    source: input.source,
    company: input.company,
    name: input.name,
  });
  const opportunity = detectOpportunity(signals, input.originalPost);
  const evidence: string[] = [];
  const issues: string[] = [];
  const text = `${input.originalPost ?? ""} ${input.notes ?? ""}`;
  if (opportunity.confidence === "FACT") {
    evidence.push(clip(opportunity.evidence));
    return {
      status: "PASS",
      summary: `Stated need: ${clip(opportunity.opportunityKey.replaceAll("_", " "))}.`,
      evidence,
      issues,
    };
  }
  if (SERVICE_NEED_RE.test(text)) {
    evidence.push(clip(text));
    return {
      status: "PASS",
      summary: "Source text shows they are looking for a service we can provide.",
      evidence,
      issues,
    };
  }
  const twitterIntent = matchTwitterServiceIntent(text);
  if (twitterIntent.ok) {
    evidence.push(clip(text));
    return {
      status: "PASS",
      summary: `X buying intent matched ${getBusinessProfile().businessName} services (${twitterIntent.serviceHints.join(", ")}).`,
      evidence,
      issues,
    };
  }
  if (opportunity.confidence === "INFERENCE") {
    evidence.push(clip(opportunity.evidence));
    issues.push("Need is inferred, not stated.");
    return {
      status: "UNKNOWN",
      summary: "Possible operational need, but they did not ask for help.",
      evidence,
      issues,
    };
  }
  issues.push("No stated request and no operational evidence of needing your business services.");
  return {
    status: "FAIL",
    summary: "No evidence they need web, software, AI, SEO, or branding help.",
    evidence,
    issues,
  };
}

function auditTwitter(input: LeadAuditInput): ChannelCheck {
  const inspected = inspectTwitterUrl(input.twitterUrl);
  if (!input.twitterUrl?.trim()) {
    return {
      status: "NOT_PRESENT",
      summary: "No X / Twitter URL on the lead.",
      evidence: [],
      issues: [],
    };
  }
  if (inspected.kind !== "person") {
    return {
      status: "FAIL",
      summary: "X URL is not a person profile.",
      evidence: [clip(input.twitterUrl)],
      issues: ["X URL is not a profile."],
    };
  }
  return {
    status: "PASS",
    summary: `X profile present (@${inspected.handle}).`,
    evidence: [inspected.url ?? input.twitterUrl],
    issues: [],
  };
}

function allowedChannelsFrom(
  email: ChannelCheck,
  linkedin: LeadAuditResult["linkedin"],
  instagram: LeadAuditResult["instagram"],
  twitter: ChannelCheck,
): OutreachChannel[] {
  const channels: OutreachChannel[] = [];
  if (email.status === "PASS" || email.status === "UNKNOWN") channels.push("EMAIL");
  if (linkedin.status === "PASS" && linkedin.seniority !== "newbie") channels.push("LINKEDIN");
  if (instagram.status === "PASS" && instagram.presence === "professional") channels.push("INSTAGRAM");
  if (twitter.status === "PASS") channels.push("X_TWITTER");
  return channels;
}

export function auditLead(input: LeadAuditInput): LeadAuditResult {
  const rawPayload = asRecord(input.rawPayload);
  const researchPayload = linkedinResearchToAuditPayload(input.linkedinResearch ?? null);
  const linkedinPayload =
    input.linkedinResearch && input.linkedinResearch.status !== "AVAILABLE" ? null : (researchPayload ?? rawPayload);
  const instagramResearchPayload = instagramResearchToAuditPayload(input.instagramResearch ?? null);
  const instagramPayload =
    input.instagramResearch && input.instagramResearch.status !== "AVAILABLE"
      ? null
      : (instagramResearchPayload ?? rawPayload);
  const email = auditEmail(input);
  const linkedin = auditLinkedIn(input, linkedinPayload);
  const instagram = auditInstagram(input, instagramPayload);
  const twitter = auditTwitter(input);
  const professional = auditProfessional(input, linkedin, instagram);
  const serviceNeed = auditServiceNeed(input);
  const allowedChannels = allowedChannelsFrom(email, linkedin, instagram, twitter);
  const blockers: string[] = [];
  const unknowns: string[] = [];

  for (const check of [email, linkedin, instagram, twitter, serviceNeed]) {
    blockers.push(...check.issues.filter((item) => /not a|invalid|disposable|newbie|personal rather|social domain|not a LinkedIn|not an Instagram|not a profile|search\/feed/i.test(item)));
    if (check.status === "UNKNOWN") unknowns.push(check.summary);
  }
  if (linkedin.seniority === "unknown" && linkedin.status !== "NOT_PRESENT") {
    unknowns.push("LinkedIn seniority is unproven. Jarvis will not invent experience.");
  }
  if (instagram.presence === "unknown" && instagram.status !== "NOT_PRESENT") {
    unknowns.push("Instagram professionalism is unproven from stored bio/posts.");
  }
  if (input.linkedinResearch?.status && input.linkedinResearch.status !== "AVAILABLE") {
    unknowns.push(`LinkedIn research ${input.linkedinResearch.status}. No profile evidence used.`);
  }
  if (input.instagramResearch?.status && input.instagramResearch.status !== "AVAILABLE") {
    unknowns.push(`Instagram research ${input.instagramResearch.status}. No profile evidence used.`);
  }

  const contactOk = allowedChannels.length > 0;
  const linkedinUnproven = linkedin.status === "UNKNOWN" || (linkedin.status !== "NOT_PRESENT" && linkedin.seniority === "unknown");
  const instagramUnproven = instagram.status === "UNKNOWN";
  const qualificationKill =
    input.qualificationDecision === "SKIP" || input.qualificationDecision === "INVALID";
  if (qualificationKill) blockers.push(`Qualification already decided ${input.qualificationDecision}.`);

  const rejectBecause =
    qualificationKill ||
    !contactOk ||
    (professional === "CONSUMER" && serviceNeed.status !== "PASS") ||
    (linkedin.seniority === "newbie" && professional !== "PROFESSIONAL" && serviceNeed.status !== "PASS");

  let verdict: AuditVerdict = "HOLD";
  if (rejectBecause) verdict = "REJECT";
  else if (
    serviceNeed.status === "PASS" &&
    allowedChannels.includes("X_TWITTER") &&
    twitter.status === "PASS"
  ) {
    // Stated buying intent on X is enough to pass Decision Maker; sends still use Gmail/LinkedIn adapters.
    verdict = "PASS";
  } else if (professional !== "PROFESSIONAL" && serviceNeed.status === "PASS") verdict = "HOLD";
  else if (professional === "PROFESSIONAL" && contactOk && !linkedinUnproven && !instagramUnproven && email.status !== "UNKNOWN") {
    verdict = "PASS";
  } else {
    verdict = "HOLD";
  }
  if (linkedin.seniority === "newbie" && verdict === "PASS") verdict = "HOLD";

  const recommendedAction =
    verdict === "PASS"
      ? `Prepare outreach on ${allowedChannels.join(", ") || "no channel"}. Prefer email/LinkedIn when enriched; X drafts stay manual. Human approval still required.`
      : verdict === "HOLD"
        ? "Do not treat as ready. Gather LinkedIn/Instagram evidence or confirm they need one of your services."
        : "Skip outreach. This is not a qualified professional buyer from stored evidence.";

  const reason = [
    `Decision maker: ${verdict}.`,
    `Professional status: ${professional}.`,
    email.summary,
    linkedin.summary,
    instagram.summary,
    twitter.summary,
    professional === "CONSUMER" || professional === "UNKNOWN"
      ? `Service-need check: ${serviceNeed.summary}`
      : serviceNeed.summary,
  ].join(" ");

  const evidenceUsed = [
    ...email.evidence,
    ...linkedin.evidence,
    ...instagram.evidence,
    ...twitter.evidence,
    ...serviceNeed.evidence,
  ].filter(Boolean);

  return {
    verdict,
    professional,
    email,
    linkedin,
    instagram,
    serviceNeed,
    allowedChannels,
    blockers: [...new Set(blockers)],
    unknowns: [...new Set(unknowns)],
    recommendedAction,
    reason,
    evidenceUsed,
  };
}

export function tightenVerdict(base: AuditVerdict, proposed?: AuditVerdict | null): AuditVerdict {
  if (!proposed) return base;
  const rank: Record<AuditVerdict, number> = { PASS: 1, HOLD: 2, REJECT: 3 };
  return rank[proposed] > rank[base] ? proposed : base;
}
