import "server-only";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { resolveAIConfig } from "@/lib/ai/config";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { getAIProvider } from "@/lib/ai";
import { composeContentDraft, businessSlice, type ContentLeadSnapshot } from "@/lib/content/compose";
import { loadPlaybook } from "@/lib/content/playbook";
import { decideContentDraft, parseContentRequest } from "@/lib/content/platforms";

const leadSelect = {
  id: true,
  name: true,
  company: true,
  industry: true,
  location: true,
  website: true,
  notes: true,
  originalPost: true,
} as const;

export async function createContentDraft(input: {
  platform?: string | null;
  kind?: string | null;
  leadId?: string | null;
  topic?: string | null;
  context?: string | null;
}) {
  const parsed = parseContentRequest(input);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };

  let lead: ContentLeadSnapshot | null = null;
  if (parsed.value.leadId) {
    lead = await prisma.lead.findUnique({
      where: { id: parsed.value.leadId },
      select: leadSelect,
    });
    if (!lead) return { ok: false as const, error: "That lead was not found." };
  }

  const playbook = loadPlaybook(parsed.value.platform);
  const business = businessSlice();
  await refreshCredentialCache();
  const provider = getAIProvider();
  const config = resolveAIConfig();

  const composed = await composeContentDraft(parsed.value, {
    playbook,
    business,
    lead,
    complete: async (messages) => {
      if (!provider.configured || !config.apiKey) return null;
      try {
        const result = await provider.generate(
          [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
          { json: true, temperature: 0.4, timeoutMs: 60_000 },
        );
        return {
          text: result.text,
          provider: config.provider,
          model: result.model || config.model,
        };
      } catch {
        return null;
      }
    },
  });

  const saved = await prisma.contentDraft.create({
    data: {
      platform: composed.platform,
      kind: composed.kind,
      leadId: composed.leadId,
      topic: composed.topic,
      context: composed.context,
      subject: composed.subject,
      message: composed.message,
      notes: composed.notes,
      status: "PENDING_APPROVAL",
      mode: composed.mode,
      modelProvider: composed.modelProvider,
      skillId: composed.skillId,
    },
  });

  await writeAudit({
    action: "content.draft",
    entity: "content_draft",
    entityId: saved.id,
    payload: {
      platform: saved.platform,
      kind: saved.kind,
      mode: saved.mode,
      modelProvider: saved.modelProvider,
      skillId: saved.skillId,
      sends: false,
    },
  });

  return { ok: true as const, draft: saved };
}

export async function reviewContentDraft(
  id: string,
  decision: "approve" | "reject" | "edit",
  extra: { message?: string; subject?: string | null; reason?: string } = {},
) {
  const existing = await prisma.contentDraft.findUnique({ where: { id } });
  if (!existing) throw new Error("Content draft not found.");
  const status = decideContentDraft(existing.status, decision);
  const message = extra.message?.trim();
  const saved = await prisma.contentDraft.update({
    where: { id },
    data: {
      status,
      ...(decision === "approve" ? { approvedAt: new Date(), approvedBy: "operator" } : {}),
      ...(decision === "reject" ? { rejectionReason: extra.reason?.trim() || "Rejected." } : {}),
      ...(decision === "edit" && message
        ? {
            message,
            subject: extra.subject?.trim() || null,
            editedAt: new Date(),
          }
        : {}),
    },
  });

  await writeAudit({
    action: `content.${decision}`,
    entity: "content_draft",
    entityId: id,
    payload: { status: saved.status, sends: false },
  });

  return saved;
}
