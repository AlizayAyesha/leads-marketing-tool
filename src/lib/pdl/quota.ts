import { HARD_PDL_DISCOVER_DAILY_CAP, HARD_PDL_LOOKUP_DAILY_CAP } from "@/lib/pdl/constants";

export type PdlDailyQuota = {
  lookupsToday: number;
  discoveriesToday: number;
  lookupsRemaining: number;
  discoveriesRemaining: number;
  lookupCap: number;
  discoverCap: number;
};

export function clampPdlDailyCap(value: unknown, hard: number, fallback: number) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hard, Math.max(0, Math.trunc(n)));
}

export function pdlDailyQuota(input: {
  lookupsToday: number;
  discoveriesToday: number;
  lookupCap?: number;
  discoverCap?: number;
}): PdlDailyQuota {
  const lookupCap = clampPdlDailyCap(input.lookupCap, HARD_PDL_LOOKUP_DAILY_CAP, HARD_PDL_LOOKUP_DAILY_CAP);
  const discoverCap = clampPdlDailyCap(
    input.discoverCap,
    HARD_PDL_DISCOVER_DAILY_CAP,
    HARD_PDL_DISCOVER_DAILY_CAP,
  );
  return {
    lookupsToday: Math.max(0, Math.trunc(input.lookupsToday)),
    discoveriesToday: Math.max(0, Math.trunc(input.discoveriesToday)),
    lookupCap,
    discoverCap,
    lookupsRemaining: Math.max(0, lookupCap - Math.max(0, Math.trunc(input.lookupsToday))),
    discoveriesRemaining: Math.max(0, discoverCap - Math.max(0, Math.trunc(input.discoveriesToday))),
  };
}
