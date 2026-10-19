import type { RawLeadInput } from "@/types";
import type { WebsiteSnapshot } from "@/types";
import type { EvidenceClaim } from "@/lib/intelligence/evidence";
import type { QualificationDecision } from "@/lib/intelligence/scoring";

export type FixtureKind =
  | "strong"
  | "weak"
  | "bad_data"
  | "misleading"
  | "unsuitable";

export type FixtureLead = {
  id: string;
  kind: FixtureKind;
  raw: RawLeadInput;
  snapshot?: WebsiteSnapshot | null;
  roleTitle?: string | null;
  evidence?: EvidenceClaim[];
  expectDecision: QualificationDecision | "DUPLICATE" | "EMPTY";
  expectOpportunityKey?: string;
  expectSolutionSlug?: string | null;
  expectDraft: boolean;
  notes: string;
};

const NOW = "2026-08-18T00:00:00.000Z";

function okSnapshot(url: string, title: string, extras: Partial<WebsiteSnapshot> = {}): WebsiteSnapshot {
  return {
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    title,
    description: extras.description ?? "Fixture public page.",
    h1: extras.h1 ?? [title],
    generator: extras.generator ?? null,
    hasViewport: extras.hasViewport ?? true,
    techHints: extras.techHints ?? ["Next.js"],
    copyright: "© 2026 fixture",
    error: null,
    fetchedAt: NOW,
  };
}

function fact(url: string, claim: string): EvidenceClaim {
  return {
    claim,
    type: "FACT",
    source: url,
    sourceUrl: url,
    snippet: claim,
    timestamp: NOW,
    observedAt: NOW,
    confidence: "high",
  };
}

function failedSnapshot(url: string, error: string): WebsiteSnapshot {
  return {
    requestedUrl: url,
    finalUrl: null,
    statusCode: null,
    title: null,
    description: null,
    h1: [],
    generator: null,
    hasViewport: false,
    techHints: [],
    copyright: null,
    error,
    fetchedAt: NOW,
  };
}

/**
 * Synthetic Marketing Brain stress fixture. Every row is marked fixture:stress.
 * Companies, evidence, and problems are invented as TEST DATA only.
 */
export const STRESS_FIXTURE: FixtureLead[] = [
  {
    id: "F01",
    kind: "strong",
    notes: "Strong automation FACT: invoicing still in spreadsheets, existing web app.",
    expectDecision: "QUALIFIED",
    expectOpportunityKey: "workflow_automation",
    expectSolutionSlug: "ai_automation",
    expectDraft: true,
    roleTitle: "Founder",
    evidence: [
      fact(
        "https://fixture.example.test/northwind-ops",
        "Hiring operations for a new route. Invoices are still a manual spreadsheet process.",
      ),
    ],
    raw: {
      name: "Priya Shah",
      company: "Northwind Ops Fixture",
      website: "https://fixture.example.test/northwind-ops",
      email: "priya@northwind-ops.fixture",
      linkedinUrl: "https://linkedin.com/company/northwind-ops-fixture",
      industry: "logistics",
      originalPost:
        "We need workflow automation for invoices. Our team still does a manual copy of every invoice into spreadsheets even though we already run a customer web app.",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Do not treat as a real company.",
    },
    snapshot: okSnapshot("https://fixture.example.test/northwind-ops", "Northwind Ops — billing portal", {
      techHints: ["Next.js", "React"],
      description: "Customer portal for logistics billing.",
    }),
  },
  {
    id: "F02",
    kind: "strong",
    notes: "Strong agentic workflow request. Must not collapse to generic AI agent.",
    expectDecision: "QUALIFIED",
    expectOpportunityKey: "agentic_workflow",
    expectSolutionSlug: "agentic_workflows",
    expectDraft: true,
    roleTitle: "Founder",
    evidence: [
      fact(
        "https://fixture.example.test/harbor-support",
        "Hiring operations during an expansion. Ticket routing is still manual.",
      ),
    ],
    raw: {
      name: "Marcus Hale",
      company: "Harbor Support Fixture",
      website: "https://fixture.example.test/harbor-support",
      email: "marcus@harbor-support.fixture",
      industry: "logistics",
      originalPost:
        "Need an agentic workflow that routes support tickets across our existing tools. Routing is still manual. We are not looking for a chatbot.",
      source: "fixture:stress",
      notes: "FIXTURE DATA.",
    },
    snapshot: okSnapshot("https://fixture.example.test/harbor-support", "Harbor Support"),
  },
  {
    id: "F03",
    kind: "strong",
    notes: "Custom internal software replacing spreadsheets.",
    expectDecision: "QUALIFIED",
    expectOpportunityKey: "custom_software",
    expectSolutionSlug: "custom_software",
    expectDraft: true,
    roleTitle: "Owner",
    evidence: [
      fact(
        "https://fixture.example.test/cedar-supply",
        "Hiring operations before a new product line. Inventory entry is still manual.",
      ),
    ],
    raw: {
      name: "Elena Ruiz",
      company: "Cedar Supply Fixture",
      website: "https://fixture.example.test/cedar-supply",
      email: "elena@cedar-supply.fixture",
      industry: "industrial",
      originalPost:
        "We need a custom internal tool to replace our spreadsheet ops for inventory. Current process is entirely manual data entry.",
      source: "fixture:stress",
      notes: "FIXTURE DATA.",
    },
    snapshot: okSnapshot("https://fixture.example.test/cedar-supply", "Cedar Supply"),
  },
  {
    id: "F04",
    kind: "strong",
    notes: "Web application for customer onboarding.",
    expectDecision: "QUALIFIED",
    expectOpportunityKey: "web_application",
    expectSolutionSlug: "web_applications",
    expectDraft: true,
    roleTitle: "CEO",
    evidence: [
      fact(
        "https://fixture.example.test/lumen",
        "Hiring operations for a new branch. Customer onboarding is still manual.",
      ),
    ],
    raw: {
      name: "Jonah Adeyemi",
      company: "Lumen Onboarding Fixture",
      website: "https://fixture.example.test/lumen",
      email: "jonah@lumen-onboarding.fixture",
      linkedinUrl: "https://linkedin.com/company/lumen-onboarding-fixture",
      industry: "professional services",
      originalPost:
        "Need a web application for customer onboarding. Current site is only a brochure and staff onboard clients with a manual process.",
      source: "fixture:stress",
      notes: "FIXTURE DATA.",
    },
    snapshot: okSnapshot("https://fixture.example.test/lumen", "Lumen — company brochure"),
  },
  {
    id: "F05",
    kind: "weak",
    notes: "Company name only. Insufficient public information.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Quiet Consulting Fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Almost no public information.",
    },
  },
  {
    id: "F06",
    kind: "weak",
    notes: "Website listed but snapshot failed.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      name: "Sam Lee",
      company: "Graystone LLC Fixture",
      website: "https://fixture.example.test/graystone-unreachable",
      email: "sam@graystone.fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA.",
    },
    snapshot: failedSnapshot("https://fixture.example.test/graystone-unreachable", "Website fetch failed"),
  },
  {
    id: "F07",
    kind: "weak",
    notes: "Professional brochure site, no request, no operational evidence.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      name: "Claire Nguyen",
      company: "Whitfield Partners Fixture",
      website: "https://fixture.example.test/whitfield",
      email: "claire@whitfield.fixture",
      industry: "law",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Brochure-only professional site.",
    },
    snapshot: okSnapshot("https://fixture.example.test/whitfield", "Whitfield Partners", {
      description: "Legal services.",
      techHints: ["WordPress"],
    }),
  },
  {
    id: "F08",
    kind: "bad_data",
    notes: "Missing company name.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      name: "Alex",
      email: "alex@missing-co.fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Missing company name.",
    },
  },
  {
    id: "F09",
    kind: "bad_data",
    notes: "Invalid URL. Must not be treated as a live site.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Bad URL Corp Fixture",
      website: "ht!tp://not a url",
      email: "ops@bad-url.fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Invalid URL.",
    },
  },
  {
    id: "F10",
    kind: "bad_data",
    notes: "Malformed email dropped; remaining record is thin.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Fake Email Inc Fixture",
      email: "sales@",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Malformed email.",
    },
  },
  {
    id: "F11",
    kind: "bad_data",
    notes: "Missing email on an otherwise thin company.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Mailless Studio Fixture",
      website: "https://fixture.example.test/mailless",
      source: "fixture:stress",
      notes: "FIXTURE DATA. No email.",
    },
    snapshot: okSnapshot("https://fixture.example.test/mailless", "Mailless Studio"),
  },
  {
    id: "F12",
    kind: "bad_data",
    notes: "Duplicate of F01 (same email).",
    expectDecision: "DUPLICATE",
    expectDraft: false,
    raw: {
      name: "Priya Shah",
      company: "Northwind Ops Fixture",
      website: "https://fixture.example.test/northwind-ops",
      email: "priya@northwind-ops.fixture",
      originalPost: "We need workflow automation for invoices. Duplicate row.",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Duplicate of F01.",
    },
  },
  {
    id: "F13",
    kind: "bad_data",
    notes: "Empty row.",
    expectDecision: "EMPTY",
    expectDraft: false,
    raw: {
      source: "fixture:stress",
    },
  },
  {
    id: "F14",
    kind: "bad_data",
    notes: "Unreachable website / timeout.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Timeout Widgets Fixture",
      website: "https://fixture.example.test/timeout",
      email: "hello@timeout-widgets.fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Unreachable website.",
    },
    snapshot: failedSnapshot("https://fixture.example.test/timeout", "Website fetch timed out"),
  },
  {
    id: "F15",
    kind: "misleading",
    notes: "AI/software/automation keywords, no request, no ops evidence.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      name: "Riley Chen",
      company: "Keyword AI Blog Fixture",
      website: "https://fixture.example.test/keyword-ai",
      email: "riley@keyword-ai.fixture",
      originalPost: "We love AI software automation SaaS.",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Keyword stuffing only.",
    },
    snapshot: okSnapshot("https://fixture.example.test/keyword-ai", "Thoughts on AI"),
  },
  {
    id: "F16",
    kind: "misleading",
    notes: "Software/automation words on a coffee brand. No problem stated.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Bean Software Cafe Fixture",
      website: "https://fixture.example.test/bean-cafe",
      email: "hello@bean-cafe.fixture",
      industry: "coffee",
      notes: "FIXTURE DATA. About text: our cafe uses software and loves automation and AI. No request.",
      source: "fixture:stress",
    },
    snapshot: okSnapshot("https://fixture.example.test/bean-cafe", "Bean Cafe"),
  },
  {
    id: "F17",
    kind: "misleading",
    notes: "SaaS mentioned as a product they sell, not a need.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "SaaS Word Inc Fixture",
      website: "https://fixture.example.test/saas-word",
      email: "info@saas-word.fixture",
      originalPost: "Proud SaaS software AI automation company.",
      source: "fixture:stress",
      notes: "FIXTURE DATA.",
    },
    snapshot: okSnapshot("https://fixture.example.test/saas-word", "SaaS Word"),
  },
  {
    id: "F18",
    kind: "unsuitable",
    notes: "Walk-in bakery. Must SKIP. No draft.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      name: "Maria Costa",
      company: "Sunset Family Bakery Fixture",
      industry: "bakery",
      originalPost: "Walk-in retail only. No website. No software.",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Clearly unsuitable.",
    },
  },
  {
    id: "F19",
    kind: "unsuitable",
    notes: "Personal hobby blog. Must SKIP.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      name: "Tom Hobby",
      company: "Tom's Stamps Blog Fixture",
      website: "https://fixture.example.test/stamps",
      email: "tom@stamps.fixture",
      industry: "hobby",
      notes: "FIXTURE DATA. Personal hobby blog about stamps.",
      source: "fixture:stress",
    },
    snapshot: okSnapshot("https://fixture.example.test/stamps", "My stamp collection"),
  },
  {
    id: "F20",
    kind: "unsuitable",
    notes: "Poor website alone must not become a website sale.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Low Score Pages Fixture",
      website: "https://fixture.example.test/low-score",
      email: "hi@low-score.fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Weak public page, no stated need.",
    },
    snapshot: {
      ...okSnapshot("https://fixture.example.test/low-score", ""),
      title: null,
      description: null,
      hasViewport: false,
      techHints: ["Wix"],
    },
  },
  {
    id: "F21",
    kind: "bad_data",
    notes: "Research timeout isolated from the batch.",
    expectDecision: "INSUFFICIENT_EVIDENCE",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Abort Fetch Fixture",
      website: "https://fixture.example.test/abort",
      email: "ops@abort.fixture",
      source: "fixture:stress",
      notes: "FIXTURE DATA. Forced research timeout.",
    },
    snapshot: failedSnapshot("https://fixture.example.test/abort", "Website fetch timed out"),
  },
  {
    id: "F22",
    kind: "weak",
    notes: "Excel mentioned without a request — not a software opportunity.",
    expectDecision: "SKIP",
    expectOpportunityKey: "unknown",
    expectSolutionSlug: null,
    expectDraft: false,
    raw: {
      company: "Excel Mention Fixture",
      website: "https://fixture.example.test/excel-mention",
      email: "team@excel-mention.fixture",
      originalPost: "We sometimes open Excel.",
      source: "fixture:stress",
      notes: "FIXTURE DATA.",
    },
    snapshot: okSnapshot("https://fixture.example.test/excel-mention", "Excel Mention Co"),
  },
];
