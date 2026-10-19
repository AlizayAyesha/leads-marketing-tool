import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { JarvisMessageRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";

export async function getOrCreateJarvisThread(threadId?: string | null) {
  if (threadId) {
    const existing = await prisma.jarvisThread.findUnique({ where: { id: threadId } });
    if (existing) return existing;
  }
  const latest = await prisma.jarvisThread.findFirst({ orderBy: { updatedAt: "desc" } });
  if (latest) return latest;
  return prisma.jarvisThread.create({ data: { title: "Jarvis" } });
}

export async function listJarvisMessages(threadId: string, take = 40) {
  return prisma.jarvisMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take,
  });
}

export async function appendJarvisMessage(input: {
  threadId: string;
  role: JarvisMessageRole;
  content: string;
  toolName?: string | null;
  toolInput?: Prisma.InputJsonValue;
  toolOutput?: Prisma.InputJsonValue;
}) {
  const row = await prisma.jarvisMessage.create({
    data: {
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      toolName: input.toolName ?? null,
      toolInput: input.toolInput ?? undefined,
      toolOutput: input.toolOutput ?? undefined,
    },
  });
  await prisma.jarvisThread.update({ where: { id: input.threadId }, data: { updatedAt: new Date() } });
  return row;
}

export async function updateJarvisThreadContext(
  threadId: string,
  patch: {
    lastLeadId?: string | null;
    lastLeadRecordId?: string | null;
    lastCompany?: string | null;
    lastDraftId?: string | null;
    title?: string | null;
  },
) {
  return prisma.jarvisThread.update({
    where: { id: threadId },
    data: {
      ...(patch.lastLeadId !== undefined ? { lastLeadId: patch.lastLeadId } : {}),
      ...(patch.lastLeadRecordId !== undefined ? { lastLeadRecordId: patch.lastLeadRecordId } : {}),
      ...(patch.lastCompany !== undefined ? { lastCompany: patch.lastCompany } : {}),
      ...(patch.lastDraftId !== undefined ? { lastDraftId: patch.lastDraftId } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
    },
  });
}
