"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { ApifyNotConfiguredError, ApifyService } from "@/lib/apify/service";
import { apifyTokenPublicStatus, saveApifyToken } from "@/lib/secrets";
import { savePdlApiKey } from "@/lib/pdl/secrets";
import { writeAudit } from "@/lib/db/settings";
import { getBrowserAgentProvider } from "@/lib/browser-agent/provider";

function refresh() {
  revalidatePath("/");
  revalidatePath("/integrations");
  revalidatePath("/integrations/apify");
  revalidatePath("/integrations/actors");
  revalidatePath("/integrations/keys");
  revalidatePath("/integrations/browser");
  revalidatePath("/integrations/linkedin");
  revalidatePath("/outreach");
  revalidatePath("/settings");
}

export async function saveApifyTokenAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  await saveApifyToken(token);
  await writeAudit({
    action: "apify.token_saved",
    entity: "integration",
    payload: { configured: Boolean(token.trim()) },
  });
  refresh();
}

export async function savePdlApiKeyAction(formData: FormData) {
  const token = String(formData.get("pdlToken") || "");
  await savePdlApiKey(token);
  await writeAudit({
    action: "pdl.token_saved",
    entity: "integration",
    payload: { configured: Boolean(token.trim()) },
  });
  refresh();
}

export async function testApifyConnection() {
  try {
    const service = new ApifyService();
    const account = await service.getAccount();
    const usage = await service.getUsage();
    await prisma.integration.upsert({
      where: { kind: "APIFY" },
      update: {
        name: "Apify",
        health: "CONNECTED",
        publicConfig: { username: account.username, plan: account.plan, hasUsage: Boolean(usage) },
        lastCheckedAt: new Date(),
        lastError: null,
      },
      create: {
        kind: "APIFY",
        name: "Apify",
        health: "CONNECTED",
        publicConfig: { username: account.username, plan: account.plan, hasUsage: Boolean(usage) },
        lastCheckedAt: new Date(),
      },
    });
    await writeAudit({ action: "apify.connected", entity: "integration" });
    refresh();
    return { ok: true as const, account, usage };
  } catch (error) {
    const message =
      error instanceof ApifyNotConfiguredError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Apify connection failed";
    await prisma.integration.upsert({
      where: { kind: "APIFY" },
      update: { health: "ERROR", lastError: message, lastCheckedAt: new Date() },
      create: { kind: "APIFY", name: "Apify", health: "ERROR", lastError: message },
    });
    refresh();
    return { ok: false as const, error: message };
  }
}

export async function testApifyConnectionAction() {
  await testApifyConnection();
}

export async function getApifyPublicState() {
  return apifyTokenPublicStatus();
}

export async function saveChromeProfileAction(formData: FormData) {
  const { listChromeProfiles, saveChromeTarget } = await import("@/lib/browser/profiles");
  const id = String(formData.get("profileId") || "jarvis");
  const profiles = listChromeProfiles();
  const chosen = profiles.find((item) => item.id === id) ?? profiles[0];
  if (!chosen) return { ok: false as const, error: "No Chrome profile was available." };
  saveChromeTarget({
    mode: chosen.mode,
    profileDirectory: chosen.directory,
    displayName: chosen.displayName,
  });
  await writeAudit({
    action: "chrome.profile_selected",
    entity: "integration",
    payload: { mode: chosen.mode, directory: chosen.directory, name: chosen.displayName },
  });
  refresh();
  return { ok: true as const, displayName: chosen.displayName };
}

export async function connectBrowserAgentAction() {
  try {
    await getBrowserAgentProvider().connect();
    const linkedin = await openLinkedInInConnectedChrome();
    revalidatePath("/integrations/browser");
    revalidatePath("/integrations/linkedin");
    revalidatePath("/integrations");
    revalidatePath("/");
    return { ok: true as const, session: getBrowserAgentProvider().status(), linkedin };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Jarvis Chrome is not available.",
    };
  }
}

export async function disconnectBrowserAgentAction() {
  const session = await getBrowserAgentProvider().disconnect();
  revalidatePath("/integrations/browser");
  revalidatePath("/integrations");
  revalidatePath("/");
  return { ok: true as const, session };
}

export async function testBrowserAgentAction() {
  return openLinkedInSessionAction();
}

export async function openLinkedInSessionAction() {
  const { getChromeSession } = await import("@/lib/tools/chrome");
  if (getChromeSession().status !== "CONNECTED") {
    return { ok: false as const, error: "Jarvis Chrome is DISCONNECTED. Click Connect first." };
  }
  const linkedin = await openLinkedInInConnectedChrome();
  revalidatePath("/integrations/browser");
  revalidatePath("/integrations/linkedin");
  return linkedin.ok
    ? { ok: true as const, url: linkedin.url, signedIn: linkedin.signedIn, message: linkedin.message }
    : { ok: false as const, error: linkedin.message };
}

async function openLinkedInInConnectedChrome() {
  const { openLinkedInFeed } = await import("@/lib/linkedin/session/open");
  const { noteChromeNavigation } = await import("@/lib/tools/chrome");
  try {
    const linkedin = await openLinkedInFeed();
    if (linkedin.ok) {
      noteChromeNavigation(linkedin.url, linkedin.signedIn ? null : linkedin.message);
    } else {
      noteChromeNavigation(null, linkedin.message);
    }
    return linkedin;
  } catch (error) {
    const message = error instanceof Error ? error.message : "LinkedIn did not open in Jarvis Chrome.";
    noteChromeNavigation(null, message);
    return {
      ok: false as const,
      code: "DISCONNECTED" as const,
      signedIn: false as const,
      url: null,
      title: null,
      state: null,
      message,
    };
  }
}

export async function getBrowserPublicState() {
  return getBrowserAgentProvider().status();
}
