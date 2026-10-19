/** Cold email send — not reply, not test-transport, not LinkedIn/X. */

export type ColdEmailDraftEvidence = {
  status: string;
  channel: string;
  stepKind?: string | null;
};

export type ColdEmailEventEvidence = {
  type: string;
  channel?: string | null;
  draftStepKind?: string | null;
};

export function isColdEmailDraftSent(draft: ColdEmailDraftEvidence): boolean {
  if (draft.status !== "SENT") return false;
  if (draft.channel !== "EMAIL") return false;
  const step = String(draft.stepKind ?? "").trim().toUpperCase();
  if (step === "REPLY" || step === "TEST_TRANSPORT") return false;
  return true;
}

export function isColdEmailReachedOut(input: {
  drafts?: ColdEmailDraftEvidence[];
  events?: ColdEmailEventEvidence[];
}): boolean {
  if ((input.drafts ?? []).some(isColdEmailDraftSent)) return true;
  return (input.events ?? []).some((event) => {
    if (event.type !== "SENT") return false;
    if (event.channel !== "EMAIL") return false;
    const step = String(event.draftStepKind ?? "").trim().toUpperCase();
    // Missing stepKind still counts as cold send; only explicit reply/test are excluded.
    if (step === "REPLY" || step === "TEST_TRANSPORT") return false;
    return true;
  });
}
