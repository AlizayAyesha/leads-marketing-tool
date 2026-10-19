import type { NamedIcpId } from "@/lib/intelligence/icps";

export const EXPERIMENT_SAMPLE = 50;

export type CampaignExperiment = {
  icp: NamedIcpId;
  location: string;
  trigger: string;
  offer: string;
  decisionMaker: string;
  sample: number;
};

export type ExperimentMeasurement = {
  researched: number;
  drafted: number;
  approved: number;
  sent: number;
  replies: number;
  qualifiedPositive: number;
  meetings: number;
};

export function createCampaignExperiment(partial: Partial<CampaignExperiment>): CampaignExperiment {
  return {
    icp: partial.icp ?? "private_aviation",
    location: (partial.location ?? "Dubai").trim() || "Dubai",
    trigger: (partial.trigger ?? "Expansion").trim() || "Expansion",
    offer: (partial.offer ?? "AI Lead Qualification").trim() || "AI Lead Qualification",
    decisionMaker: (partial.decisionMaker ?? "COO").trim() || "COO",
    sample: EXPERIMENT_SAMPLE,
  };
}

export function experimentCap(experiment: CampaignExperiment) {
  return Math.min(EXPERIMENT_SAMPLE, Math.max(1, experiment.sample));
}

/** North star for an experiment cell — not raw reply count. */
export function qualifiedPositiveRate(m: ExperimentMeasurement) {
  if (!m.sent) return 0;
  return Math.round((m.qualifiedPositive / m.sent) * 1000) / 10;
}
