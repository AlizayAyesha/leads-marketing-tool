import type { EvidenceFinding } from "@/types";
import type { LeadSignals } from "@/lib/intelligence/signals";
import { extractSignals } from "@/lib/intelligence/signals";
import { SIGNAL_CONTRACT_VERSION } from "@/lib/contracts/common";
import { assertSignalEvidence, leadSignalsContractSchema, type LeadSignalsContract, type SignalItem } from "@/lib/contracts/signals";

export type StructuredSignalInput = {
  leadId: string;
  name?: string | null;
  company?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  industry?: string | null;
  location?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  source?: string | null;
  websiteQuality?: number | null;
  findings?: EvidenceFinding[];
  techSignals?: string[];
  problems?: string[];
  missingFeatures?: string[];
  linkedinResearch?: {
    status?: string | null;
    headline?: string | null;
    currentCompany?: string | null;
    roleTitle?: string | null;
    location?: string | null;
    industry?: string | null;
    about?: string | null;
    sourceUrl?: string | null;
    evidenceItems?: unknown;
  } | null;
  instagramResearch?: {
    status?: string | null;
    username?: string | null;
    displayName?: string | null;
    bio?: string | null;
    professionalCategory?: string | null;
    sourceUrl?: string | null;
    evidenceItems?: unknown;
  } | null;
};

const HIRING_RE = /\b(hiring|we're hiring|we are hiring|join our team|open role|job opening)\b/i;
const FUNDING_RE = /\b(raised|series [a-c]|seed round|funding|backed by)\b/i;
const EXPANSION_RE = /\b(expanding|new location|new office|new market|growing (the )?team)\b/i;
const NEW_PRODUCT_RE = /\b(launch(ing)?|new product|new platform|new app)\b/i;
const SIZE_RE = /\b(\d{1,4})\s*(employees|staff|people|person team)\b/i;
const ROLE_RE = /\b(founder|co-founder|ceo|cto|cmo|owner|director|head of|vp|manager)\b/i;
const MANUAL_RE = /\b(manual (data|process|workflow|entry)|spreadsheet|copy[- ]paste|repetitive)\b/i;
const SUPPORT_RE = /\b(customer support|helpdesk|ticket|inbox overflow)\b/i;
const CRM_RE = /\b(crm|salesforce|hubspot|pipedrive|no crm)\b/i;

function quote(source: string | null | undefined, re: RegExp) {
  const text = source ?? "";
  const match = text.match(re);
  if (!match) return null;
  const start = Math.max(0, (match.index ?? 0) - 40);
  return text.slice(start, start + 160).trim();
}

function add(
  items: SignalItem[],
  input: {
    id: string;
    kind: SignalItem["kind"];
    label: string;
    present: boolean;
    evidence: string;
    confidence?: SignalItem["confidence"];
    sourceUrl?: string | null;
  },
) {
  items.push(
    assertSignalEvidence({
      id: input.id,
      kind: input.kind,
      label: input.label,
      present: input.present,
      evidence: input.evidence,
      confidence: input.confidence,
      sourceUrl: input.sourceUrl ?? null,
    }),
  );
}

export function buildLeadSignalsContract(input: StructuredSignalInput, now = new Date()): LeadSignalsContract {
  const legacy: LeadSignals = extractSignals(input);
  const text = `${input.originalPost ?? ""} ${input.notes ?? ""}`.trim();
  const items: SignalItem[] = [];
  const findings = input.findings ?? [];

  add(items, {
    id: "identity-name",
    kind: "identity",
    label: "Named contact",
    present: Boolean(input.name),
    evidence: input.name ? `Lead name on record: ${input.name}` : "",
    confidence: input.name ? "observed" : "unknown",
  });
  add(items, {
    id: "identity-company",
    kind: "company",
    label: "Company identity",
    present: Boolean(input.company),
    evidence: input.company ? `Company on record: ${input.company}` : "",
    confidence: input.company ? "observed" : "unknown",
  });

  const roleQuote = quote(text, ROLE_RE);
  add(items, {
    id: "role",
    kind: "role",
    label: "Role / seniority mentioned",
    present: Boolean(roleQuote),
    evidence: roleQuote ?? "",
    confidence: roleQuote ? "observed" : "unknown",
  });

  add(items, {
    id: "industry",
    kind: "industry",
    label: "Industry",
    present: Boolean(input.industry),
    evidence: input.industry ? `Industry field: ${input.industry}` : "",
    confidence: input.industry ? "observed" : "unknown",
  });

  add(items, {
    id: "geography",
    kind: "company",
    label: "Geography",
    present: Boolean(input.location),
    evidence: input.location ? `Location field: ${input.location}` : "",
    confidence: input.location ? "observed" : "unknown",
  });

  const sizeQuote = quote(text, SIZE_RE);
  add(items, {
    id: "company-size",
    kind: "company",
    label: "Company size",
    present: Boolean(sizeQuote),
    evidence: sizeQuote ?? "",
    confidence: sizeQuote ? "observed" : "unknown",
  });

  add(items, {
    id: "website",
    kind: "website",
    label: "Public website",
    present: Boolean(input.website),
    evidence: input.website ? input.website : "",
    sourceUrl: input.website ?? null,
    confidence: input.website ? "observed" : "unknown",
  });

  if (legacy.website_quality != null) {
    add(items, {
      id: "website-quality",
      kind: "digital",
      label: "Website quality band",
      present: true,
      evidence: `Heuristic website quality ${legacy.website_quality}/10 (${legacy.website_quality_band}).`,
      sourceUrl: input.website ?? null,
      confidence: "inferred",
    });
  }

  add(items, {
    id: "contact-email",
    kind: "contact",
    label: "Email on file",
    present: Boolean(input.email),
    evidence: input.email ? `Email present: ${input.email}` : "",
    confidence: input.email ? "observed" : "unknown",
  });
  add(items, {
    id: "contact-linkedin",
    kind: "contact",
    label: "LinkedIn URL on file",
    present: Boolean(input.linkedinUrl),
    evidence: input.linkedinUrl ?? "",
    sourceUrl: input.linkedinUrl ?? null,
  });

  const linkedinEvidence = Array.isArray(input.linkedinResearch?.evidenceItems)
    ? input.linkedinResearch.evidenceItems
    : [];
  if (input.linkedinResearch?.status === "AVAILABLE") {
    for (const item of linkedinEvidence) {
      if (!item || typeof item !== "object") continue;
      const evidenceItem = item as { category?: string; value?: string; evidence?: string; sourceUrl?: string | null; confidence?: string };
      if (!evidenceItem.value || !evidenceItem.evidence) continue;
      if (/\bneeds?\s+(a\s+)?(website|ai|seo|automation)\b/i.test(`${evidenceItem.value} ${evidenceItem.evidence}`)) continue;
      const kind: SignalItem["kind"] =
        evidenceItem.category === "role_title" || evidenceItem.category === "headline"
          ? "role"
          : evidenceItem.category === "current_company" || evidenceItem.category === "company_association"
            ? "company"
            : evidenceItem.category === "industry"
              ? "industry"
              : evidenceItem.category === "location"
                ? "company"
                : evidenceItem.category === "profile_url"
                  ? "contact"
                  : "identity";
      add(items, {
        id: `linkedin-${evidenceItem.category ?? items.length}`,
        kind,
        label: `LinkedIn ${String(evidenceItem.category ?? "signal").replaceAll("_", " ")}`,
        present: true,
        evidence: evidenceItem.evidence,
        sourceUrl: evidenceItem.sourceUrl ?? input.linkedinResearch.sourceUrl ?? input.linkedinUrl ?? null,
        confidence: evidenceItem.confidence === "inferred" ? "inferred" : "observed",
      });
    }
  } else if (input.linkedinResearch?.status && input.linkedinResearch.status !== "AVAILABLE") {
    add(items, {
      id: "linkedin-research-status",
      kind: "source",
      label: "LinkedIn research availability",
      present: true,
      evidence: `LinkedIn research status ${input.linkedinResearch.status}. No profile evidence stored.`,
      sourceUrl: input.linkedinUrl ?? null,
      confidence: "observed",
    });
  }
  add(items, {
    id: "contact-instagram",
    kind: "contact",
    label: "Instagram URL on file",
    present: Boolean(input.instagramUrl),
    evidence: input.instagramUrl ?? "",
    sourceUrl: input.instagramUrl ?? null,
  });

  const instagramEvidence = Array.isArray(input.instagramResearch?.evidenceItems)
    ? input.instagramResearch.evidenceItems
    : [];
  if (input.instagramResearch?.status === "AVAILABLE") {
    for (const item of instagramEvidence) {
      if (!item || typeof item !== "object") continue;
      const evidenceItem = item as { category?: string; value?: string; evidence?: string; sourceUrl?: string | null; confidence?: string };
      if (!evidenceItem.value || !evidenceItem.evidence) continue;
      if (/\bneeds?\s+(a\s+)?(website|ai|seo|automation)\b/i.test(`${evidenceItem.value} ${evidenceItem.evidence}`)) continue;
      const kind: SignalItem["kind"] =
        evidenceItem.category === "professional_category" || evidenceItem.category === "public_business"
          ? "company"
          : evidenceItem.category === "website"
            ? "website"
            : evidenceItem.category === "profile_url" || evidenceItem.category === "username"
              ? "contact"
              : "identity";
      add(items, {
        id: `instagram-${evidenceItem.category ?? items.length}`,
        kind,
        label: `Instagram ${String(evidenceItem.category ?? "signal").replaceAll("_", " ")}`,
        present: true,
        evidence: evidenceItem.evidence,
        sourceUrl: evidenceItem.sourceUrl ?? input.instagramResearch.sourceUrl ?? input.instagramUrl ?? null,
        confidence: evidenceItem.confidence === "inferred" ? "inferred" : "observed",
      });
    }
  } else if (input.instagramResearch?.status && input.instagramResearch.status !== "AVAILABLE") {
    add(items, {
      id: "instagram-research-status",
      kind: "source",
      label: "Instagram research availability",
      present: true,
      evidence: `Instagram research status ${input.instagramResearch.status}. No profile evidence stored.`,
      sourceUrl: input.instagramUrl ?? null,
      confidence: "observed",
    });
  }

  for (const finding of findings) {
    if (!finding?.finding || !finding.evidence) continue;
    const kind: SignalItem["kind"] =
      finding.category === "tech"
        ? "technology"
        : finding.category === "problem" || finding.category === "missing_feature"
          ? "pain"
          : finding.category === "ai"
            ? "automation"
            : finding.category === "seo" || finding.category === "website_quality" || finding.category === "branding"
              ? "digital"
              : "pain";
    add(items, {
      id: `finding-${items.length}`,
      kind,
      label: finding.finding,
      present: true,
      evidence: finding.evidence,
      sourceUrl: finding.sourceUrl,
      confidence: finding.confidence === "observed" ? "observed" : finding.confidence === "inferred" ? "inferred" : "unknown",
    });
  }

  for (const tech of input.techSignals ?? []) {
    add(items, {
      id: `tech-${tech}`,
      kind: "technology",
      label: "Observed technology",
      present: true,
      evidence: tech,
      sourceUrl: input.website ?? null,
      confidence: "observed",
    });
  }

  const hiring = quote(text, HIRING_RE);
  add(items, { id: "buying-hiring", kind: "buying", label: "Hiring signal", present: Boolean(hiring), evidence: hiring ?? "" });
  const funding = quote(text, FUNDING_RE);
  add(items, { id: "growth-funding", kind: "growth", label: "Funding signal", present: Boolean(funding), evidence: funding ?? "" });
  const expansion = quote(text, EXPANSION_RE);
  add(items, { id: "growth-expansion", kind: "growth", label: "Expansion signal", present: Boolean(expansion), evidence: expansion ?? "" });
  const product = quote(text, NEW_PRODUCT_RE);
  add(items, { id: "growth-product", kind: "growth", label: "New product signal", present: Boolean(product), evidence: product ?? "" });

  const requestEvidence = legacy.explicit_request ? text.slice(0, 220) : "";
  add(items, {
    id: "buying-explicit-need",
    kind: "buying",
    label: "Explicit service need",
    present: legacy.explicit_request,
    evidence: requestEvidence,
    confidence: legacy.explicit_request ? "observed" : "unknown",
  });

  const manual = quote(text, MANUAL_RE);
  add(items, { id: "auto-manual", kind: "automation", label: "Manual / repetitive process", present: Boolean(manual), evidence: manual ?? "" });
  const support = quote(text, SUPPORT_RE);
  add(items, { id: "auto-support", kind: "automation", label: "Customer-support opportunity", present: Boolean(support), evidence: support ?? "" });
  const crm = quote(text, CRM_RE);
  add(items, { id: "auto-crm", kind: "automation", label: "CRM opportunity", present: Boolean(crm), evidence: crm ?? "" });

  const evidence = items
    .filter((item) => item.present && !item.rejected)
    .map((item) => ({
      text: item.evidence,
      sourceUrl: item.sourceUrl,
      confidence: item.confidence,
    }));

  const payload: LeadSignalsContract = {
    version: SIGNAL_CONTRACT_VERSION,
    leadId: input.leadId,
    identity: {
      name: input.name ?? null,
      company: input.company ?? (input.linkedinResearch?.currentCompany || null),
      role: roleQuote
        ? (text.match(ROLE_RE)?.[0] ?? null)
        : input.linkedinResearch?.roleTitle || input.linkedinResearch?.headline || null,
    },
    company: {
      industry: input.industry ?? null,
      size: sizeQuote ? (text.match(SIZE_RE)?.[0] ?? null) : null,
      geography: input.location ?? null,
    },
    website: {
      url: input.website ?? null,
      quality: legacy.website_quality,
      qualityBand: legacy.website_quality_band,
    },
    contactChannels: {
      email: Boolean(input.email),
      phone: Boolean(input.phone),
      linkedin: Boolean(input.linkedinUrl),
      instagram: Boolean(input.instagramUrl),
      facebook: Boolean(input.facebookUrl),
      twitter: Boolean(input.twitterUrl),
    },
    items,
    evidence,
    source: input.source ?? null,
    timestamp: now.toISOString(),
    legacy,
  };

  return leadSignalsContractSchema.parse(payload);
}

export function toLegacySignals(contract: LeadSignalsContract): LeadSignals {
  return contract.legacy;
}
