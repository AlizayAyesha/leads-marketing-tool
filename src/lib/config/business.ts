import {
  DEFAULT_QUALIFICATION_POLICY,
  DEFAULT_SCORING_WEIGHTS,
  type QualificationPolicy,
  type ScoringWeights,
} from "@/lib/intelligence/scoring";
import { DEFAULT_SOLUTIONS, type SolutionRecord } from "@/lib/intelligence/solutions";

export const BUSINESS_POLICY_KEY = "business.policy";

export type IcpConfig = {
  industries: string[];
  geographies: string[];
  jobTitles: string[];
  companySize: string;
  exclusions: string[];
  notes: string;
};

export type OutreachPolicy = {
  tone: "low_pressure" | "consultative" | "direct";
  maxFollowUps: number;
  allowGenericAgencyIntro: boolean;
  structure: "observation_relevance_value_cta";
};

export type BusinessPolicy = {
  icp: IcpConfig;
  scoring: ScoringWeights;
  qualification: QualificationPolicy;
  outreach: OutreachPolicy;
  draftChannels: Array<"EMAIL" | "LINKEDIN" | "INSTAGRAM" | "FACEBOOK" | "X_TWITTER">;
  solutions: SolutionRecord[];
};

export const DEFAULT_BUSINESS_POLICY: BusinessPolicy = {
  icp: {
    industries: [],
    geographies: [],
    jobTitles: [
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
    ],
    companySize: "",
    exclusions: [
      "software development",
      "graphic design",
      "recruiting",
      "staffing",
      "human resources",
    ],
    notes:
      "Edit your ideal customer in Settings → Business Profile. These ICP fields feed people-search queries.",
  },
  scoring: DEFAULT_SCORING_WEIGHTS,
  qualification: DEFAULT_QUALIFICATION_POLICY,
  outreach: {
    tone: "low_pressure",
    maxFollowUps: 1,
    allowGenericAgencyIntro: false,
    structure: "observation_relevance_value_cta",
  },
  draftChannels: ["EMAIL", "LINKEDIN", "X_TWITTER"],
  solutions: DEFAULT_SOLUTIONS,
};

export function mergeBusinessPolicy(raw: unknown): BusinessPolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_BUSINESS_POLICY;
  const value = raw as Partial<BusinessPolicy>;
  return {
    ...DEFAULT_BUSINESS_POLICY,
    ...value,
    icp: { ...DEFAULT_BUSINESS_POLICY.icp, ...value.icp },
    scoring: { ...DEFAULT_BUSINESS_POLICY.scoring, ...value.scoring },
    qualification: { ...DEFAULT_BUSINESS_POLICY.qualification, ...value.qualification },
    outreach: { ...DEFAULT_BUSINESS_POLICY.outreach, ...value.outreach },
    draftChannels: value.draftChannels ?? DEFAULT_BUSINESS_POLICY.draftChannels,
    solutions: value.solutions?.length ? value.solutions : DEFAULT_BUSINESS_POLICY.solutions,
  };
}
