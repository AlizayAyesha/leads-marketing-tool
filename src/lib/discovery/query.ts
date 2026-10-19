import { DEFAULT_DISCOVERY_TITLE_ROLES } from "@/lib/pdl/constants";
import type { IcpConfig } from "@/lib/config/business";
import { getBusinessProfile } from "@/lib/business/profile";

const SAFE_TOKEN = /^[a-z0-9][a-z0-9 &._-]{0,80}$/i;
const KNOWN_ROLES = new Set<string>([
  ...DEFAULT_DISCOVERY_TITLE_ROLES,
  "founder",
  "owner",
  "marketing",
  "sales",
  "operations",
  "product",
  "strategy",
]);

const COUNTRY_ALIASES: Record<string, string> = {
  us: "united states",
  usa: "united states",
  "united states": "united states",
  uk: "united kingdom",
  "united kingdom": "united kingdom",
  uae: "united arab emirates",
  pk: "pakistan",
  pakistan: "pakistan",
};

function sanitizeTokens(values: string[]) {
  return values.map((item) => item.trim()).filter((item) => SAFE_TOKEN.test(item));
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''").toLowerCase()}'`;
}

function sqlList(values: string[]) {
  return values.map(sqlString).join(", ");
}

function asCountry(value: string) {
  return COUNTRY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export const DEFAULT_BUYER_TITLES = [
  "founder",
  "co-founder",
  "ceo",
  "coo",
  "owner",
  "managing director",
  "agency owner",
  "head of operations",
  "head of marketing",
  "marketing director",
] as const;

export function buildPdlDiscoverySql(icp: IcpConfig) {
  const jobTitles = sanitizeTokens(icp.jobTitles?.length ? icp.jobTitles : (getBusinessProfile().targetRoles.length ? getBusinessProfile().targetRoles : [...DEFAULT_BUYER_TITLES]));
  const roles = [...new Set(jobTitles.filter((item) => KNOWN_ROLES.has(item.toLowerCase())))];
  const titleNeedles = jobTitles.filter((item) => !KNOWN_ROLES.has(item.toLowerCase()));
  const industries = sanitizeTokens(icp.industries ?? []);
  const countries = sanitizeTokens(icp.geographies ?? [])
    .map(asCountry)
    .filter((item): item is string => Boolean(item));
  const exclusions = sanitizeTokens(icp.exclusions ?? []);

  const titleParts = [
    ...(roles.length ? [`job_title_role IN (${sqlList(roles)})`] : []),
    ...titleNeedles.map((title) => `job_title LIKE '%${title.replaceAll("'", "''").toLowerCase()}%'`),
    ...roles.map((role) => `job_title LIKE '%${role.replaceAll("'", "''").toLowerCase()}%'`),
  ];
  const titleClause = titleParts.length ? `(${titleParts.join(" OR ")})` : `job_title_role IN (${sqlList([...DEFAULT_DISCOVERY_TITLE_ROLES])})`;

  const clauses = ["linkedin_url IS NOT NULL", titleClause, "job_title_role NOT IN ('student')"];
  if (industries.length) {
    clauses.push(`industry IN (${sqlList(industries)})`);
  }
  if (countries.length) {
    clauses.push(`location_country IN (${sqlList(countries)})`);
  }
  for (const exclusion of exclusions) {
    clauses.push(`NOT (industry LIKE '%${exclusion.replaceAll("'", "''").toLowerCase()}%')`);
  }

  return `SELECT * FROM person WHERE ${clauses.join(" AND ")}`;
}
