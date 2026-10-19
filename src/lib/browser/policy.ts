import { assertExternalActionAllowed } from "@/lib/intelligence/approval";
import { isExternalBusinessAction, type BrowserAction } from "@/lib/browser/types";

export class BrowserActionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserActionBlockedError";
  }
}

export function assertBrowserActionAllowed(input: {
  action: BrowserAction;
  simulate?: boolean;
  approvalStatus?: string | null;
}) {
  if (!isExternalBusinessAction(input.action)) return;

  if (input.simulate) {
    throw new BrowserActionBlockedError(
      "ACTION_BLOCKED_SIMULATION: external browser communication is disabled in simulation mode.",
    );
  }

  try {
    assertExternalActionAllowed(input.approvalStatus);
  } catch {
    throw new BrowserActionBlockedError(
      "EXTERNAL_ACTION_BLOCKED: no server-side APPROVED record for this browser business action.",
    );
  }
}
