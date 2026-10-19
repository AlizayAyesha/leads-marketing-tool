"use server";

import { revalidatePath } from "next/cache";

import { removeSenderAccount, updateSenderAccount } from "@/lib/outreach/sender-accounts";

export async function updateSenderAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await updateSenderAccount(id, {
    dailySendLimit: formData.get("dailySendLimit"),
    enabled: formData.get("enabled") === "on",
  });
  revalidatePath("/settings/senders");
}

export async function removeSenderAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await removeSenderAccount(id);
  revalidatePath("/settings/senders");
}
