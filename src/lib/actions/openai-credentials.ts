"use server";

import { revalidatePath } from "next/cache";

import {
  addOpenAICredential,
  deleteCredential,
  migrateEnvCredential,
  saveCredentialPolicy,
  setCredentialEnabled,
  testCredential,
} from "@/lib/ai/credentials";
import type { CredentialPolicyState } from "@/lib/ai/types";

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/settings/ai");
  revalidatePath("/integrations/ai");
  revalidatePath("/integrations/keys");
  revalidatePath("/integrations");
  revalidatePath("/");
}

export async function addOpenAICredentialAction(formData: FormData) {
  const name = String(formData.get("name") || "");
  const apiKey = String(formData.get("apiKey") || "");
  const result = await addOpenAICredential({ name, apiKey });
  refresh();
  return result;
}

export async function testOpenAICredentialAction(id: string) {
  const result = await testCredential(id);
  refresh();
  return result;
}

export async function setOpenAICredentialEnabledAction(id: string, enabled: boolean) {
  const result = await setCredentialEnabled(id, enabled);
  refresh();
  return result;
}

export async function deleteOpenAICredentialAction(id: string) {
  const result = await deleteCredential(id);
  refresh();
  return result;
}

export async function migrateEnvOpenAICredentialAction() {
  const result = await migrateEnvCredential("Environment key");
  refresh();
  return result;
}

export async function saveOpenAICredentialPolicyAction(input: Partial<CredentialPolicyState>) {
  const result = await saveCredentialPolicy(input);
  refresh();
  return result;
}
