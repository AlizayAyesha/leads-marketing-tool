export type WorkforceFunnel = {
  jobId: string;
  command: string;
  simulate: boolean;
  imported: number;
  valid: number;
  researched: number;
  opportunities: number;
  qualified: number;
  recommended: number;
  drafts: number;
  sent: 0;
  failed: number;
  status: "AWAITING_YOUR_APPROVAL";
  leadIds: string[];
  stages: string[];
  note?: string;
  draftPreviews?: WorkforceDraftPreview[];
};

export type WorkforceDraftPreview = {
  draftId: string;
  leadId: string;
  lead: string;
  company: string | null;
  opportunity: string | null;
  businessProblem: string | null;
  qualificationScore: number | null;
  recommendedService: string | null;
  channel: string;
  draft: string;
  approvalStatus: string;
};

export type WorkforcePlan = {
  intent: "PROCESS_WORKFORCE" | "SIMULATE_CAMPAIGN";
  importSheet: boolean;
  limit: number;
  top: number;
  simulate: boolean;
  stages: string[];
  opening: string;
};

export function isWorkforceFunnel(value: unknown): value is WorkforceFunnel {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.sent === 0 && row.status === "AWAITING_YOUR_APPROVAL" && typeof row.jobId === "string";
}
