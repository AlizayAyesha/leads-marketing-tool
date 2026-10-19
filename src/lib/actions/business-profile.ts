"use server";

import { revalidatePath } from "next/cache";

import { saveBusinessProfile } from "@/lib/business/store";
import { writeAudit } from "@/lib/db/settings";

export async function saveBusinessProfileAction(formData: FormData) {
  const raw: Record<string, unknown> = {};
  for (const key of [
    "businessName", "description", "website", "companySize", "bookingUrl",
    "services", "targetIndustries", "targetLocations", "targetRoles",
    "includeKeywords", "excludeKeywords", "competitors",
  ]) {
    raw[key] = String(formData.get(key) ?? "");
  }
  for (const key of ["excludeAgencies", "excludeTechCompanies", "excludeRecruiters", "excludeJuniorRoles", "requireDemandSignal"]) {
    raw[key] = formData.get(key) === "on";
  }
  const profile = await saveBusinessProfile(raw);
  await writeAudit({ action: "business_profile.save", entity: "business_profile", entityId: "default", payload: { businessName: profile.businessName } });
  revalidatePath("/settings/business");
}
