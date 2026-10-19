"use server";

import { revalidatePath } from "next/cache";

import {
  approveLinkedInConnection,
  checkLinkedInConnectionStatus,
  confirmLinkedInConnectionRequested,
  recommendLinkedInConnection,
  recommendLinkedInPostConnectionMessage,
} from "@/lib/linkedin/connection/lifecycle";

function refresh(leadId: string) {
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/outreach");
}

export async function recommendLinkedInConnectionAction(leadId: string) {
  const result = await recommendLinkedInConnection(leadId);
  refresh(leadId);
  return result;
}

export async function approveLinkedInConnectionAction(leadId: string) {
  const result = await approveLinkedInConnection(leadId);
  refresh(leadId);
  return result;
}

export async function confirmLinkedInConnectionRequestedAction(leadId: string) {
  const result = await confirmLinkedInConnectionRequested(leadId);
  refresh(leadId);
  return result;
}

export async function checkLinkedInConnectionStatusAction(leadId: string) {
  const result = await checkLinkedInConnectionStatus(leadId);
  refresh(leadId);
  return result;
}

export async function recommendLinkedInPostConnectionMessageAction(leadId: string) {
  const result = await recommendLinkedInPostConnectionMessage(leadId);
  refresh(leadId);
  return result;
}
