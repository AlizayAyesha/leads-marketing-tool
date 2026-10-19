import type { OutreachChannel, ZarService } from "@prisma/client";

export type FindingCategory =
  | "website_quality"
  | "tech"
  | "problem"
  | "missing_feature"
  | "webdev"
  | "ai"
  | "seo"
  | "branding"
  | "contact"
  | "other";

export type FindingConfidence = "observed" | "inferred" | "unknown";

export type EvidenceFinding = {
  finding: string;
  evidence: string;
  reason: string;
  sourceUrl: string | null;
  category: FindingCategory;
  confidence: FindingConfidence;
};

export type ScoreBreakdown = {
  relevance: number;
  need: number;
  affordability: number;
  urgency: number;
  digitalPresence: number;
  websiteQuality: number;
  aiOpportunity: number;
  activeNeed: number;
  contactability: number;
};

export type WebsiteSnapshot = {
  requestedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  title: string | null;
  description: string | null;
  h1: string[];
  generator: string | null;
  hasViewport: boolean;
  techHints: string[];
  copyright: string | null;
  error: string | null;
  fetchedAt: string;
  linkedinUrls?: string[];
};

export type RawLeadInput = {
  name?: string | null;
  company?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  source?: string | null;
  location?: string | null;
  industry?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  testRecipient?: string | boolean | null;
  externalRowId?: string | null;
  sourceActor?: string | null;
  sourceUrl?: string | null;
};

export type ColumnMap = Partial<Record<keyof RawLeadInput, string>>;

export type IntegrationStatus = {
  configured: boolean;
  label: string;
  detail: string;
};

export type JarvisCommandResult = {
  intent: string;
  summary: string;
  taskIds: string[];
  leadIds: string[];
  data?: unknown;
};

export type OutreachStrategy = {
  shouldContactNow: boolean;
  channel: OutreachChannel;
  tone: "conversational" | "consultative" | "direct";
  firstMessageGoal: string;
  talkingPoints: string[];
  doNotSay: string[];
  followUpStrategy: string;
  reasonForContacting: string;
};

export type OpportunityOutput = {
  problem: string;
  evidence: string;
  evidenceUrl: string | null;
  recommendedService: ZarService;
  suggestedOffer: string;
  projectCategory: string;
  nextStep: string;
  confidence: FindingConfidence;
};
