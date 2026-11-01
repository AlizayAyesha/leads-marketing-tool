"use server";

import { revalidatePath } from "next/cache";

import { createContentDraft, reviewContentDraft } from "@/lib/content/run";

function revalidate() {
  revalidatePath("/content");
  revalidatePath("/outreach");
  revalidatePath("/");
}

export async function draftContentAction(form: FormData) {
  const result = await createContentDraft({
    platform: String(form.get("platform") ?? ""),
    kind: String(form.get("kind") ?? ""),
    leadId: String(form.get("leadId") ?? ""),
    topic: String(form.get("topic") ?? ""),
    context: String(form.get("context") ?? ""),
  });
  if (result.ok) revalidate();
  if (!result.ok) return { ok: false as const, error: result.error };
  return {
    ok: true as const,
    id: result.draft.id,
    message: result.draft.message,
    subject: result.draft.subject,
    notes: result.draft.notes,
    mode: result.draft.mode,
    modelProvider: result.draft.modelProvider,
  };
}

export async function approveContentDraft(id: string) {
  await reviewContentDraft(id, "approve");
  revalidate();
  return {
    ok: true,
    message: "Approved for you to copy. This app does not post or send it.",
  };
}

export async function rejectContentDraft(id: string, reason: string) {
  await reviewContentDraft(id, "reject", { reason });
  revalidate();
  return { ok: true, message: "Content draft rejected. Nothing was posted." };
}

export async function editContentDraft(id: string, message: string, subject: string) {
  await reviewContentDraft(id, "edit", { message, subject });
  revalidate();
  return { ok: true, message: "Edit saved. It stays in Approvals until you approve it." };
}
