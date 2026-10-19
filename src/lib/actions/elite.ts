"use server";

import { revalidatePath } from "next/cache";

import { runEliteExperiment } from "@/lib/elite/experiment";

function refresh() {
  revalidatePath("/integrations/scraping");
  revalidatePath("/integrations/sheets");
  revalidatePath("/");
  revalidatePath("/outreach");
  revalidatePath("/leads");
  revalidatePath("/research");
}

export async function runEliteExperimentAction() {
  try {
    const report = await runEliteExperiment();
    if (!report.sheet?.ok) {
      throw new Error(report.sheet?.message ?? "Google Sheet was not updated. Done waits until leads are written there.");
    }
    refresh();
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Elite experiment failed.";
    const where = error instanceof Error ? error.stack?.split("\n").slice(1, 4).map((line) => line.trim()).join(" ") : "";
    throw new Error(where ? `${message} (${where})` : message);
  }
}
