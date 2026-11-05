export const LEASE_MS = 120_000;

export type LeaseSnapshot = {
  status: string;
  attempts: number;
  maxRetries: number;
  availableAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
};

/** A running task whose lease is in the past is retried, or failed once attempts are spent. */
export function leaseDecision(task: Pick<LeaseSnapshot, "status" | "attempts" | "maxRetries" | "leaseExpiresAt">, now: number) {
  if (task.status !== "RUNNING") return "keep" as const;
  if (task.leaseExpiresAt == null || task.leaseExpiresAt > now) return "keep" as const;
  if (task.attempts > task.maxRetries) return "fail" as const;
  return "retry" as const;
}

export function backoffMs(attempts: number) {
  return Math.min(15 * 60 * 1000, Math.max(1, attempts) * 15_000);
}

/**
 * In-memory claim. The database path uses the same predicate inside a single UPDATE
 * so two workers cannot both move the row to RUNNING.
 */
export function claimSnapshot(task: LeaseSnapshot, workerId: string, now: number): { task: LeaseSnapshot; won: boolean } {
  if (task.status !== "QUEUED" && task.status !== "RETRYING") return { task, won: false };
  if (task.availableAt > now) return { task, won: false };
  return {
    won: true,
    task: {
      ...task,
      status: "RUNNING",
      attempts: task.attempts + 1,
      leaseOwner: workerId,
      leaseExpiresAt: now + LEASE_MS,
    },
  };
}

export function claimContended(task: LeaseSnapshot, workers: string[], now: number) {
  let current = task;
  const winners: string[] = [];
  for (const workerId of workers) {
    const result = claimSnapshot(current, workerId, now);
    if (result.won) {
      current = result.task;
      winners.push(workerId);
    }
  }
  return { task: current, winners };
}
