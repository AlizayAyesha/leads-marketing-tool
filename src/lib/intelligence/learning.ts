import type { NamedIcpId } from "@/lib/intelligence/icps";
import type { LostReason } from "@/lib/intelligence/lost-reasons";

export type LearningRow = {
  icp: NamedIcpId | "unknown";
  offer: string;
  trigger: string;
  angle: string;
  decisionMakerRole: string;
  sent: boolean;
  replied: boolean;
  qualifiedPositive: boolean;
  meeting: boolean;
  lostReason: LostReason | null;
};

export function learningKey(row: Pick<LearningRow, "icp" | "offer" | "trigger" | "angle" | "decisionMakerRole">) {
  return [row.icp, row.offer, row.trigger, row.angle, row.decisionMakerRole].join(" | ");
}

export function summarizeLearning(rows: LearningRow[]) {
  const buckets = new Map<
    string,
    { key: string; sent: number; replies: number; qualifiedPositive: number; meetings: number; lost: Record<string, number> }
  >();
  for (const row of rows) {
    const key = learningKey(row);
    const bucket = buckets.get(key) ?? {
      key,
      sent: 0,
      replies: 0,
      qualifiedPositive: 0,
      meetings: 0,
      lost: {},
    };
    if (row.sent) bucket.sent += 1;
    if (row.replied) bucket.replies += 1;
    if (row.qualifiedPositive) bucket.qualifiedPositive += 1;
    if (row.meeting) bucket.meetings += 1;
    if (row.lostReason) bucket.lost[row.lostReason] = (bucket.lost[row.lostReason] ?? 0) + 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.qualifiedPositive - a.qualifiedPositive || b.meetings - a.meetings);
}
