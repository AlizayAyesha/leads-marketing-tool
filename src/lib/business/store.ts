import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  normalizeBusinessProfile,
  setActiveBusinessProfile,
  getBusinessProfile,
  type BusinessProfile,
} from "@/lib/business/profile";

/** Load the saved profile from Postgres (if any) and make it the active one. */
export async function loadBusinessProfile(): Promise<BusinessProfile> {
  try {
    const row = await prisma.businessProfile.findUnique({ where: { id: "default" } });
    if (row) setActiveBusinessProfile(row.data as Partial<BusinessProfile>);
  } catch {
    // DB unreachable: keep file/default profile.
  }
  return getBusinessProfile();
}

export async function saveBusinessProfile(input: unknown): Promise<BusinessProfile> {
  const profile = normalizeBusinessProfile(input);
  const data = profile as unknown as Prisma.InputJsonValue;
  await prisma.businessProfile.upsert({
    where: { id: "default" },
    update: { data },
    create: { id: "default", data },
  });
  setActiveBusinessProfile(profile);
  return profile;
}
