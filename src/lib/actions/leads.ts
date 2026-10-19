"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { IntakeAgent } from "@/lib/agents/intake";
import { csvToObjects } from "@/lib/leads/normalize";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { writeAudit } from "@/lib/db/settings";
import type { RawLeadInput } from "@/types";

export async function createManualLead(formData: FormData) {
  const raw: RawLeadInput = {
    name: String(formData.get("name") || ""),
    company: String(formData.get("company") || ""),
    website: String(formData.get("website") || ""),
    email: String(formData.get("email") || ""),
    phone: String(formData.get("phone") || ""),
    linkedinUrl: String(formData.get("linkedinUrl") || ""),
    instagramUrl: String(formData.get("instagramUrl") || ""),
    facebookUrl: String(formData.get("facebookUrl") || ""),
    twitterUrl: String(formData.get("twitterUrl") || ""),
    source: String(formData.get("source") || "manual"),
    location: String(formData.get("location") || ""),
    industry: String(formData.get("industry") || ""),
    originalPost: String(formData.get("originalPost") || ""),
    notes: String(formData.get("notes") || ""),
  };

  const source = await prisma.leadSource.upsert({
    where: { id: "manual-source" },
    update: {},
    create: { id: "manual-source", type: "MANUAL", name: "Manual entry" },
  }).catch(async () =>
    prisma.leadSource.create({ data: { type: "MANUAL", name: "Manual entry" } }),
  );

  const agent = new IntakeAgent();
  const result = await agent.execute({
    prompt: DEFAULT_PROMPTS.intake.content,
    payload: { leads: [raw], sourceId: source.id, sourceName: "manual" },
  });

  revalidatePath("/");
  revalidatePath("/leads");
  return result;
}

export async function importCsv(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "CSV file is required" };
  const text = await file.text();
  const rows = csvToObjects(text);
  const leads: RawLeadInput[] = rows.map((row) => ({
    name: row.Name || row.name,
    company: row.Company || row.company,
    website: row.Website || row.website,
    email: row.Email || row.email,
    phone: row.Phone || row.phone,
    linkedinUrl: row.LinkedIn || row.linkedin || row.linkedinUrl,
    instagramUrl: row.Instagram || row.instagram,
    facebookUrl: row.Facebook || row.facebook,
    twitterUrl: row.Twitter || row.X || row.twitter,
    source: row.Source || row.source || "csv",
    location: row.Location || row.location,
    industry: row.Industry || row.industry,
    originalPost: row["Original post"] || row.originalPost || row.Post,
    notes: row.Notes || row.notes,
  }));

  const source = await prisma.leadSource.create({
    data: { type: "CSV", name: file.name || "CSV import" },
  });
  const result = await new IntakeAgent().execute({
    prompt: DEFAULT_PROMPTS.intake.content,
    payload: { leads, sourceId: source.id, sourceName: "csv" },
  });
  await writeAudit({ action: "intake.csv", entity: "lead_source", entityId: source.id, payload: result.output });
  revalidatePath("/leads");
  revalidatePath("/");
  return result.output;
}

export async function markDoNotContact(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: "DO_NOT_CONTACT", suppressed: true, lastActivityAt: new Date() },
  });
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (lead?.email) {
    await prisma.suppression.upsert({
      where: { email: lead.email },
      update: { reason: "operator" },
      create: { email: lead.email, domain: lead.websiteHost, reason: "operator" },
    });
  }
  await writeAudit({ action: "lead.dnc", entity: "lead", entityId: leadId });
  const { stopLinkedInConnectionLifecycle } = await import("@/lib/linkedin/connection/lifecycle");
  await stopLinkedInConnectionLifecycle(leadId, "do_not_contact");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
}
