"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  completeTestRecipientModeAction,
  confirmTestOutreachAction,
  discoverTestRecipientAction,
  prepareTestTransportAction,
  sendTestTransportAction,
} from "@/lib/actions/test-recipient";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { TestRecipientSession } from "@/lib/outreach/test-flag";
import { TEST_TRANSPORT_COMMAND } from "@/lib/outreach/test-transport";
import type { OutreachEnginePolicy } from "@/lib/outreach/policy";

export function TestRecipientPanel({
  session,
  recipient,
  emailDraft,
  gmailSendReady,
  policy,
  googleEmail,
}: {
  session: TestRecipientSession;
  recipient: {
    id: string;
    leadId: string;
    name: string | null;
    company: string | null;
    email: string | null;
    linkedinUrl: string | null;
    instagramUrl: string | null;
  } | null;
  emailDraft: { id: string; subject: string | null; message: string } | null;
  gmailSendReady: boolean;
  policy: Pick<OutreachEnginePolicy, "sendsPaused" | "sendMode">;
  googleEmail: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const killSwitchOff = !policy.sendsPaused;
  const sendModeReady = policy.sendMode === "send_on_approve";
  const canSend =
    Boolean(emailDraft) &&
    Boolean(session.confirmedAt) &&
    !session.emailSentAt &&
    gmailSendReady &&
    killSwitchOff &&
    sendModeReady &&
    command.trim().toUpperCase() === TEST_TRANSPORT_COMMAND;

  return (
    <section className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <h2 className="font-[family-name:var(--font-syne)] text-lg">Test recipient · Gmail transport</h2>
      <p className="mt-1 text-sm text-muted">
        Labeled one-off Gmail infrastructure test. Decision Maker HOLD/REJECT still blocks normal outreach. This
        panel does not send LinkedIn or Instagram.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
        <li>Gmail send: {gmailSendReady ? `ready (${googleEmail || "connected"})` : "missing — reconnect /api/google/oauth?gmail=1"}</li>
        <li>Kill switch: {killSwitchOff ? "OFF (required for this test)" : "ON — turn it off in the engine panel for the test"}</li>
        <li>Send mode: {sendModeReady ? "send_on_approve" : `${policy.sendMode} — set to send_on_approve for the test`}</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await discoverTestRecipientAction();
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Load marked Sheet row
        </Button>
        {recipient && session.enabled && !session.confirmedAt ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await confirmTestOutreachAction(recipient.id);
                setNotice(result.message);
                router.refresh();
              })
            }
          >
            Confirm this is the test recipient
          </Button>
        ) : null}
        {recipient && session.confirmedAt && !session.emailSentAt ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await prepareTestTransportAction(recipient.id);
                setNotice(result.ok ? result.message : result.message);
                router.refresh();
              })
            }
          >
            Prepare labeled test email
          </Button>
        ) : null}
        {session.enabled || session.disabledAt ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await completeTestRecipientModeAction();
                setNotice(result.message);
                router.refresh();
              })
            }
          >
            Disable test mode now
          </Button>
        ) : null}
      </div>
      {recipient ? (
        <dl className="mt-4 grid gap-1 text-sm">
          <div>
            <dt className="inline text-muted">Name: </dt>
            <dd className="inline">{recipient.name || "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted">Email: </dt>
            <dd className="inline">{recipient.email || "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Mark exactly one Leads row with Test recipient = true, then load it here.
        </p>
      )}
      {emailDraft ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="text-muted">To: </span>
            {recipient?.email}
          </p>
          <p>
            <span className="text-muted">From: </span>
            {googleEmail || "—"}
          </p>
          <p>
            <span className="text-muted">Subject: </span>
            {emailDraft.subject || "(none)"}
          </p>
          <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs">{emailDraft.message}</pre>
          <div className="max-w-md">
            <Label htmlFor="send-test-command">Type SEND TEST EMAIL to authorize Gmail</Label>
            <Input
              id="send-test-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={TEST_TRANSPORT_COMMAND}
            />
          </div>
          <Button
            type="button"
            disabled={pending || !canSend}
            onClick={() =>
              start(async () => {
                const result = await sendTestTransportAction(emailDraft.id, command);
                setNotice(result.message);
                setCommand("");
                router.refresh();
              })
            }
          >
            Send labeled test email
          </Button>
        </div>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-emerald-200">{notice}</p> : null}
    </section>
  );
}
