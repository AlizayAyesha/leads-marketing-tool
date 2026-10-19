export const PIPELINE_STEPS = [
  "research",
  "linkedin_research",
  "instagram_research",
  "signals",
  "qualification",
  "opportunity",
  "decision_maker",
  "strategist",
  "outreach_writer",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];
