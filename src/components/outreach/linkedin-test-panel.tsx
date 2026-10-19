"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  sendLinkedInTestFormAction,
  checkLinkedInTestStatusAction,
  ingestLinkedInTestReplyAction,
} from "@/lib/actions/test-recipient";
import { Button } from "@/components/ui/button";
import type { TestRecipientSession } from "@/lib/outreach/test-flag";
import type { OutreachEnginePolicy } from "@/lib/outreach/policy";

export function LinkedInTestSendPanel({
  session,
  recipient,
  policy,
  send,
}: {
  session: TestRecipientSession;
  recipient: {
    id: string;
    leadId: string;
    name: string | null;
    company: string | null;
    linkedinUrl: string | null;
    decisionMaker: string | null;
    connectionStatus: string | null;
  } | null;
  policy: Pick<OutreachEnginePolicy, "sendsPaused">;
  send: {
    sendReady: boolean;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const killSwitchOff = !policy.sendsPaused;
  const confirmed = Boolean(session.enabled && session.confirmedAt && recipient);
  const canAttempt = confirmed && killSwitchOff && send.sendReady && Boolean(recipient?.linkedinUrl);
  const last = session.lastLinkedinTest;

  return (
    <section className="mb-8 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-sky-300/90">Controlled test</p>
      <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg">Test LinkedIn Send</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Isolated LinkedIn transport check against your authenticated Chrome session. It does not change production
        Decision Maker, commercial relevance, or daily outreach eligibility. Global kill switch still wins. Use your own test contact
        only.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
        <li>Test mode: {session.enabled ? "ON" : "OFF"}</li>
        <li>Test recipient: {confirmed ? "confirmed" : "not confirmed"}</li>
        <li>
          LinkedIn send:{" "}
          {send.sendReady
            ? "Jarvis Chrome LinkedIn session ready"
            : "LinkedIn sending unavailable — connect Jarvis Chrome with your signed-in LinkedIn account."}
        </li>
        <li>Kill switch: {killSwitchOff ? "OFF" : "ON — turn it off in the engine panel to test"}</li>
        <li>Production Decision Maker: {recipient?.decisionMaker ?? "—"} (unchanged by this panel)</li>
      </ul>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-muted">
        <li>Authenticated LinkedIn session in Jarvis Chrome</li>
        <li>Open the test contact’s profile</li>
        <li>Send connection → actual LinkedIn result → REQUESTED</li>
        <li>Check status → CONNECTED only after real acceptance</li>
        <li>Send message only once CONNECTED</li>
        <li>Read inbound reply into the sales engine</li>
        <li>CTA /go/linkedin when meeting intent exists</li>
        <li>Booking attribution → MEETING_BOOKED → stop</li>
      </ol>
      {recipient ? (
        <dl className="mt-4 grid gap-1 text-sm">
          <div>
            <dt className="inline text-muted">Recipient: </dt>
            <dd className="inline">{recipient.name || recipient.leadId}</dd>
          </div>
          <div>
            <dt className="inline text-muted">LinkedIn: </dt>
            <dd className="inline">
              {recipient.linkedinUrl ? (
                <a className="underline" href={recipient.linkedinUrl}>
                  {recipient.linkedinUrl}
                </a>
              ) : (
                "missing"
              )}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted">Connection state: </dt>
            <dd className="inline">{recipient.connectionStatus || "NOT_REQUESTED"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted">Confirm a test recipient in the Gmail test panel first.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !canAttempt}
          onClick={() =>
            start(async () => {
              const result = await sendLinkedInTestFormAction("connection");
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Send Test Connection
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !canAttempt}
          onClick={() =>
            start(async () => {
              const result = await sendLinkedInTestFormAction("message");
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Send Test Message
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !confirmed || !send.sendReady}
          onClick={() =>
            start(async () => {
              const result = await checkLinkedInTestStatusAction();
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Check acceptance
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !confirmed || !send.sendReady}
          onClick={() =>
            start(async () => {
              const result = await ingestLinkedInTestReplyAction();
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Read inbound reply
        </Button>
        <Link href="/integrations/linkedin" className="inline-flex items-center text-sm text-sky-200 underline">
          LinkedIn send status
        </Link>
      </div>
      {last ? (
        <p className="mt-3 text-xs text-muted">
          Last test: {last.kind} · {last.provider} · {last.code} · {last.externalId || "no external id"} · {last.sentAt}
        </p>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-emerald-200">{notice}</p> : null}
    </section>
  );
}
