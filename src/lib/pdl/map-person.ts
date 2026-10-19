import { evidenceFromProfile } from "@/lib/linkedin/evidence";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import {
  emptyLinkedInProfile,
  type LinkedInProfile,
  type LinkedInResearchResult,
} from "@/lib/linkedin/types";
import { PDL_ADAPTER_ID, PDL_ADAPTER_VERSION } from "@/lib/pdl/constants";
import type { PdlExperience, PdlPerson } from "@/lib/pdl/types";

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function experienceTitle(item: PdlExperience) {
  if (typeof item.title === "string") return clean(item.title);
  return clean(item.title?.name);
}

function experienceCompany(item: PdlExperience) {
  if (typeof item.company === "string") return clean(item.company);
  return clean(item.company?.name);
}

export function normalizePdlLinkedInUrl(value?: string | null) {
  const inspected = inspectLinkedInUrl(value);
  return inspected.normalizedUrl;
}

export function mapPdlPersonToProfile(
  person: PdlPerson,
  requestedUrl: string,
): LinkedInProfile | null {
  const profileUrl =
    normalizePdlLinkedInUrl(person.linkedin_url) ??
    inspectLinkedInUrl(requestedUrl).normalizedUrl ??
    requestedUrl;
  if (!profileUrl) return null;

  const experiences = (person.experience ?? [])
    .map((item) => ({
      title: experienceTitle(item),
      company: experienceCompany(item),
      start_date: clean(item.start_date),
      end_date: clean(item.end_date),
    }))
    .filter((item) => item.title || item.company);

  const location = clean(person.location_name);
  const industry = clean(person.industry) ?? clean(person.job_company_industry);
  const roleTitle = clean(person.job_title);
  const headline = clean(person.headline) ?? roleTitle;
  const company = clean(person.job_company_name);

  return {
    ...emptyLinkedInProfile(profileUrl),
    profileUrl,
    displayName: clean(person.full_name),
    headline,
    currentCompany: company,
    roleTitle,
    location,
    industry,
    about: clean(person.summary),
    companyAssociation: company,
    publicSignals: {
      pdlId: person.id ?? null,
      job_title_role: person.job_title_role ?? null,
      job_title_levels: person.job_title_levels ?? [],
      connections: person.linkedin_connections ?? null,
      yearsOfExperience:
        typeof person.inferred_years_experience === "number" && Number.isFinite(person.inferred_years_experience)
          ? person.inferred_years_experience
          : null,
      experiences,
    },
  };
}

export function pdlPersonToResearchResult(input: {
  person: PdlPerson;
  requestedUrl: string;
  likelihood?: number;
  retrievedAt?: string;
}): LinkedInResearchResult {
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const profile = mapPdlPersonToProfile(input.person, input.requestedUrl);
  if (!profile) {
    return {
      status: "ERROR",
      code: "PDL_NO_LINKEDIN_URL",
      profile: null,
      evidence: [],
      sourceUrl: input.requestedUrl || null,
      retrievedAt,
      adapter: PDL_ADAPTER_ID,
      adapterVersion: PDL_ADAPTER_VERSION,
      message: "PDL matched a person but returned no researchable LinkedIn URL.",
    };
  }
  const evidence = evidenceFromProfile(profile, retrievedAt);
  return {
    status: "AVAILABLE",
    code: "OK",
    profile,
    evidence,
    sourceUrl: profile.profileUrl,
    retrievedAt,
    adapter: PDL_ADAPTER_ID,
    adapterVersion: PDL_ADAPTER_VERSION,
    message:
      typeof input.likelihood === "number"
        ? `People Data Labs person enrichment (likelihood ${input.likelihood}).`
        : "People Data Labs person enrichment.",
  };
}

export function pdlDisplayName(person: PdlPerson) {
  const full = clean(person.full_name);
  if (full) return full;
  const joined = [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ");
  return joined || null;
}
