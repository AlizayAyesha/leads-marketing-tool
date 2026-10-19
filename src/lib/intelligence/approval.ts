const APPROVED = new Set(["APPROVED"]);

const SEND_BLOCKING_PHRASES = [
  /\bdo not send\b/i,
  /\bdon't send\b/i,
  /\bdraft only\b/i,
  /\bprepare\b/i,
  /\bsimulate\b/i,
];

export function commandForbidsSending(command: string) {
  return SEND_BLOCKING_PHRASES.some((pattern) => pattern.test(command));
}

export function canTransitionDraftTo(
  current: string,
  next: string,
  input: { explicitApproval?: boolean } = {},
) {
  if (next === "APPROVED") return input.explicitApproval === true;
  if (next === "SENT") return current === "APPROVED" && input.explicitApproval === true;
  return next !== "SENT";
}

export function canPerformExternalAction(approvalStatus: string | null | undefined) {
  return Boolean(approvalStatus && APPROVED.has(approvalStatus));
}

export function assertExternalActionAllowed(approvalStatus: string | null | undefined) {
  if (!canPerformExternalAction(approvalStatus)) {
    throw new Error("EXTERNAL_ACTION_BLOCKED: no server-side APPROVED record.");
  }
}

/** Server-boundary send. Never succeeds without APPROVED. No send adapter is enabled. */
export function attemptExternalAction(input: {
  approvalStatus: string | null | undefined;
  adapterAvailable?: boolean;
}) {
  assertExternalActionAllowed(input.approvalStatus);
  if (!input.adapterAvailable) {
    throw new Error("NO_SEND_ADAPTER: external send is not enabled. EXTERNAL_MESSAGES_SENT remains 0.");
  }
  throw new Error("NO_SEND_ADAPTER: no live channel adapter is registered.");
}
