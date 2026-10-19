export type CredentialPolicy = "ROUND_ROBIN" | "SINGLE_PRIMARY" | "LEAST_RECENTLY_USED";

export type SelectableCredential = {
  id: string;
  lastUsedAt: Date | null;
};

export function eligibleIds(items: Array<{ id: string; enabled: boolean; status: string; cooldownUntil?: Date | null }>, now = new Date()) {
  return items
    .filter((item) => {
      if (!item.enabled) return false;
      if (item.status === "UNHEALTHY" || item.status === "DISABLED") return false;
      if (item.cooldownUntil && item.cooldownUntil > now) return false;
      return item.status === "HEALTHY" || item.status === "RATE_LIMITED";
    })
    .filter((item) => !(item.status === "RATE_LIMITED" && item.cooldownUntil && item.cooldownUntil > now))
    .map((item) => item.id);
}

export function selectCredential(
  policy: CredentialPolicy,
  credentials: SelectableCredential[],
  roundRobinIndex = 0,
) {
  if (credentials.length === 0) return { id: null as string | null, nextIndex: 0 };
  if (policy === "SINGLE_PRIMARY") {
    return { id: credentials[0].id, nextIndex: roundRobinIndex };
  }
  if (policy === "LEAST_RECENTLY_USED") {
    const sorted = [...credentials].sort((a, b) => {
      const aTime = a.lastUsedAt?.getTime() ?? 0;
      const bTime = b.lastUsedAt?.getTime() ?? 0;
      return aTime - bTime;
    });
    return { id: sorted[0].id, nextIndex: roundRobinIndex };
  }
  const index = ((roundRobinIndex % credentials.length) + credentials.length) % credentials.length;
  return { id: credentials[index].id, nextIndex: (index + 1) % credentials.length };
}

export function remainingAttempts(tried: string[], eligible: string[]) {
  return eligible.filter((id) => !tried.includes(id));
}
