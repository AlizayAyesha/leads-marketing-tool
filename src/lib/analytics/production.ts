import type { Prisma } from "@prisma/client";

export const PRODUCTION_ENVIRONMENT = "PRODUCTION";
export const TEST_ENVIRONMENT = "TEST";

const TEST_EMAIL_MARKERS = ["@invalid.test", ".invalid.test"];
const TEST_SOURCE_PREFIXES = ["e2e-"];
const TEST_COMPANY_MARKERS = ["(reply harness)"];

export type LeadMetricRecord = {
  environment?: string | null;
  fixture?: boolean | null;
  testRecipient?: boolean | null;
  source?: string | null;
  email?: string | null;
  company?: string | null;
};

export function classifyLeadEnvironment(lead: LeadMetricRecord) {
  return isTestLeadRecord(lead) ? TEST_ENVIRONMENT : PRODUCTION_ENVIRONMENT;
}

export function isTestLeadRecord(lead: LeadMetricRecord) {
  if ((lead.environment ?? "").trim().toUpperCase() === TEST_ENVIRONMENT) return true;
  if (lead.fixture) return true;
  if (lead.testRecipient) return true;

  const source = (lead.source ?? "").trim().toLowerCase();
  if (TEST_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix))) return true;

  const email = (lead.email ?? "").trim().toLowerCase();
  if (TEST_EMAIL_MARKERS.some((marker) => email.includes(marker))) return true;

  const company = lead.company ?? "";
  if (TEST_COMPANY_MARKERS.some((marker) => company.toLowerCase().includes(marker.toLowerCase()))) {
    return true;
  }
  return false;
}

export function productionLeadWhere(): Prisma.LeadWhereInput {
  return {
    AND: [
      { NOT: { environment: TEST_ENVIRONMENT } },
      { fixture: false },
      { testRecipient: false },
      {
        OR: [{ source: null }, { NOT: { source: { startsWith: "e2e-", mode: "insensitive" } } }],
      },
      {
        OR: [
          { email: null },
          {
            AND: [
              { NOT: { email: { contains: "@invalid.test", mode: "insensitive" } } },
              { NOT: { email: { endsWith: ".invalid.test", mode: "insensitive" } } },
            ],
          },
        ],
      },
      {
        OR: [{ company: null }, { NOT: { company: { contains: "(reply harness)", mode: "insensitive" } } }],
      },
    ],
  };
}
