import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export async function remember(input: {
  platform?: string | null;
  kind: string;
  subject: string;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.jarvisMemory.create({
    data: {
      platform: input.platform ?? null,
      kind: input.kind,
      subject: input.subject,
      content: input.content,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function recall(input: { platform?: string; kind?: string; take?: number }) {
  return prisma.jarvisMemory.findMany({
    where: {
      platform: input.platform,
      kind: input.kind,
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 20,
  });
}
