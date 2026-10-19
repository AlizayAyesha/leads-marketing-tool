import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export async function emitBrainEvent(type: string, payload: Record<string, unknown> = {}) {
  await prisma.brainEvent.create({
    data: { type, payload: payload as Prisma.InputJsonValue },
  });
}
