import "server-only";

import { getSetting, setSetting } from "@/lib/db/settings";
import {
  BUSINESS_POLICY_KEY,
  DEFAULT_BUSINESS_POLICY,
  mergeBusinessPolicy,
  type BusinessPolicy,
} from "@/lib/config/business";

export async function getBusinessPolicy(): Promise<BusinessPolicy> {
  const stored = await getSetting<unknown>(BUSINESS_POLICY_KEY, DEFAULT_BUSINESS_POLICY);
  return mergeBusinessPolicy(stored);
}

export async function saveBusinessPolicy(policy: BusinessPolicy) {
  await setSetting(BUSINESS_POLICY_KEY, mergeBusinessPolicy(policy));
}
