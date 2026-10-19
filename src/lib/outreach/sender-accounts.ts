import "server-only";

import { google } from "googleapis";

import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting, writeAudit } from "@/lib/db/settings";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import { googleOAuthClient } from "@/lib/data-sources/google";
import {
  clampSenderDailyLimit,
  DEFAULT_SENDER_DAILY_LIMIT,
  pickSender,
  startOfUtcDay,
  type PoolAccount,
} from "@/lib/outreach/sender-pool";

const CURSOR_KEY = "gmail.senders.cursor";

function enc(value: string | null | undefined) {
  return value ? JSON.stringify(encryptSecret(value)) : null;
}
function dec(value: string | null | undefined) {
  if (!value) return null;
  try {
    return decryptSecret(JSON.parse(value));
  } catch {
    return null;
  }
}

/** OAuth callback (state=sender): store or refresh one sender inbox. Tokens are encrypted at rest. */
export async function storeSenderAccountFromCode(code: string) {
  const client = googleOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const profile = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = profile.data.email?.toLowerCase();
  if (!email) throw new Error("Google did not return an email for this account.");
  const data = {
    displayName: profile.data.name ?? null,
    accessTokenEnc: enc(tokens.access_token),
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: tokens.scope ? tokens.scope.split(/\s+/) : [],
  };
  await prisma.gmailSenderAccount.upsert({
    where: { email },
    update: { ...data, ...(tokens.refresh_token ? { refreshTokenEnc: enc(tokens.refresh_token) } : {}) },
    create: { email, ...data, refreshTokenEnc: enc(tokens.refresh_token), dailySendLimit: DEFAULT_SENDER_DAILY_LIMIT },
  });
  await writeAudit({ action: "gmail_sender.connected", entity: "gmail_sender", entityId: email });
  return email;
}

export async function listSenderAccounts(now = new Date()) {
  const since = startOfUtcDay(now);
  const rows = await prisma.gmailSenderAccount.findMany({
    orderBy: { email: "asc" },
    include: { _count: { select: { sends: { where: { sentAt: { gte: since } } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    enabled: row.enabled,
    dailySendLimit: row.dailySendLimit,
    sentToday: row._count.sends,
    canSend: Boolean(row.refreshTokenEnc || row.accessTokenEnc) && row.scopes.some((s) => s.includes("gmail.send")),
    createdAt: row.createdAt,
  }));
}

export async function updateSenderAccount(id: string, input: { dailySendLimit?: unknown; enabled?: boolean }) {
  await prisma.gmailSenderAccount.update({
    where: { id },
    data: {
      ...(input.dailySendLimit !== undefined ? { dailySendLimit: clampSenderDailyLimit(input.dailySendLimit) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  await writeAudit({ action: "gmail_sender.updated", entity: "gmail_sender", entityId: id, payload: input });
}

export async function removeSenderAccount(id: string) {
  await prisma.gmailSenderAccount.delete({ where: { id } });
  await writeAudit({ action: "gmail_sender.removed", entity: "gmail_sender", entityId: id });
}

export async function hasSenderPool() {
  try {
    return (await prisma.gmailSenderAccount.count({ where: { enabled: true } })) > 0;
  } catch {
    return false;
  }
}

/** Pick the next inbox (round-robin, per-account caps). Null = every inbox is at its cap or disabled. */
export async function nextSenderAccount() {
  const accounts = (await listSenderAccounts()).filter((a) => a.canSend);
  const cursor = await getSetting<number>(CURSOR_KEY, -1);
  const picked = pickSender(accounts as PoolAccount[], cursor);
  if (!picked) return null;
  await setSetting(CURSOR_KEY, picked.cursor);
  return picked.account;
}

export async function senderGmailClient(accountId: string) {
  const row = await prisma.gmailSenderAccount.findUniqueOrThrow({ where: { id: accountId } });
  const client = googleOAuthClient();
  client.setCredentials({
    access_token: dec(row.accessTokenEnc) ?? undefined,
    refresh_token: dec(row.refreshTokenEnc) ?? undefined,
    expiry_date: row.tokenExpiry?.getTime(),
  });
  client.on("tokens", (tokens) => {
    void prisma.gmailSenderAccount
      .update({
        where: { id: accountId },
        data: {
          accessTokenEnc: enc(tokens.access_token) ?? undefined,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
          ...(tokens.refresh_token ? { refreshTokenEnc: enc(tokens.refresh_token) } : {}),
        },
      })
      .catch(() => undefined);
  });
  return { client, account: row };
}

export async function recordSenderSend(accountId: string, input: { draftId?: string | null; messageId?: string | null }) {
  await prisma.gmailSenderSend.create({ data: { accountId, draftId: input.draftId ?? null, messageId: input.messageId ?? null } });
}
