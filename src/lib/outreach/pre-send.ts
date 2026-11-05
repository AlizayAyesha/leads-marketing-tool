export type ImmediateSendInput = {
  sendsPaused: boolean;
  sendMode: string;
  suppressed: boolean;
  unsubscribed: boolean;
  bounced: boolean;
  leadStatus: string;
  draftStatus: string;
  alreadySent: boolean;
  explicitApproval: boolean;
  quotaRemaining: number;
  senderBlockCode: string | null;
  sequenceActive: boolean;
};

export type ImmediateSendDecision = { ok: true } | { ok: false; code: string; message: string };

function no(code: string, message: string): ImmediateSendDecision {
  return { ok: false, code, message };
}

/** Checked again immediately before a provider send. A status read never reaches this. */
export function immediateSendDecision(input: ImmediateSendInput): ImmediateSendDecision {
  if (input.alreadySent) return no("ALREADY_SENT", "This draft was already sent.");
  if (input.draftStatus !== "APPROVED") return no("NOT_APPROVED", "Draft is not approved.");
  if (!input.explicitApproval && input.sendMode !== "auto") return no("NOT_APPROVED", "Explicit approval is required.");
  if (input.sendsPaused) return no("KILL_SWITCH", "Sends are paused.");
  if (input.sendMode === "draft_only") return no("DRAFT_ONLY", "Send mode is draft-only.");
  if (input.bounced) return no("BOUNCED", "This address bounced. Follow-ups are stopped.");
  if (input.suppressed || input.unsubscribed || input.leadStatus === "DO_NOT_CONTACT") {
    return no("SUPPRESSED", "Send blocked: suppressed, unsubscribed, or do-not-contact.");
  }
  if (!input.sequenceActive) return no("SEQUENCE_STOPPED", "Sequence is not active.");
  if (input.quotaRemaining <= 0) return no("QUOTA_EXCEEDED", "Daily send quota is exhausted.");
  if (input.senderBlockCode) return no(input.senderBlockCode, "Sender identity or unsubscribe configuration is incomplete.");
  return { ok: true };
}

export function usageAllows(input: { used: number; limit: number }) {
  return input.limit > 0 && input.used < input.limit;
}
