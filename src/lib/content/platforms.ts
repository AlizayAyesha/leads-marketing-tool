export const CONTENT_PLATFORMS = [
  { id: "X", label: "X", skillId: "x-growth", folder: "x-growth" },
  { id: "LINKEDIN", label: "LinkedIn", skillId: "linkedin-growth", folder: "linkedin-growth" },
  { id: "INSTAGRAM", label: "Instagram", skillId: "instagram-growth", folder: "instagram-growth" },
  { id: "TIKTOK", label: "TikTok", skillId: "tiktok-growth", folder: "tiktok-growth" },
  { id: "REDDIT", label: "Reddit", skillId: "reddit-growth", folder: "reddit-growth" },
  { id: "FACEBOOK", label: "Facebook", skillId: "facebook-growth", folder: "facebook-growth" },
  { id: "THREADS", label: "Threads", skillId: "threads-growth", folder: "threads-growth" },
] as const;

export const CONTENT_KINDS = [
  { id: "POST", label: "Post" },
  { id: "COMMENT", label: "Comment / reply" },
  { id: "DM", label: "DM" },
] as const;

export type ContentPlatformId = (typeof CONTENT_PLATFORMS)[number]["id"];
export type ContentKindId = (typeof CONTENT_KINDS)[number]["id"];

/** Content Agent never posts or sends. Approval only marks a draft ready to copy. */
export const CONTENT_AGENT_SENDS = false as const;

export function platformById(id: ContentPlatformId) {
  const row = CONTENT_PLATFORMS.find((item) => item.id === id);
  if (!row) throw new Error(`Unknown content platform: ${id}`);
  return row;
}

export function contentKindLabel(id: ContentKindId) {
  return CONTENT_KINDS.find((item) => item.id === id)?.label ?? id;
}

export type ContentRequest = {
  platform: ContentPlatformId;
  kind: ContentKindId;
  leadId: string | null;
  topic: string | null;
  context: string | null;
};

export function parseContentRequest(input: {
  platform?: string | null;
  kind?: string | null;
  leadId?: string | null;
  topic?: string | null;
  context?: string | null;
}): { ok: true; value: ContentRequest } | { ok: false; error: string } {
  const platform = CONTENT_PLATFORMS.find((item) => item.id === (input.platform ?? "").trim())?.id;
  if (!platform) return { ok: false, error: "Choose a platform." };
  const kind = CONTENT_KINDS.find((item) => item.id === (input.kind ?? "").trim())?.id;
  if (!kind) return { ok: false, error: "Choose a post, a comment/reply, or a DM." };
  const leadId = input.leadId?.trim() || null;
  const topic = input.topic?.trim() || null;
  const context = input.context?.trim() || null;
  if (!leadId && !topic) return { ok: false, error: "Add a lead or a topic." };
  if (topic && topic.length > 500) return { ok: false, error: "Keep the topic under 500 characters." };
  if (context && context.length > 8000) return { ok: false, error: "Keep the extra context under 8000 characters." };
  return { ok: true, value: { platform, kind, leadId, topic, context } };
}

const REVIEWABLE = new Set(["DRAFT", "PENDING_APPROVAL", "EDITED", "APPROVED", "REJECTED"]);

/** Human review of a content draft. The result is never SENT. */
export function decideContentDraft(
  current: string,
  decision: "approve" | "reject" | "edit",
): "APPROVED" | "REJECTED" | "EDITED" {
  if (current === "SENT") throw new Error("CONTENT_NEVER_SENDS");
  if (!REVIEWABLE.has(current)) throw new Error("CONTENT_DRAFT_CLOSED");
  if (decision === "approve") return "APPROVED";
  if (decision === "reject") return "REJECTED";
  return "EDITED";
}
