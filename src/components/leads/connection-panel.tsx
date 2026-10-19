"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  approveLinkedInConnectionAction,
  checkLinkedInConnectionStatusAction,
  confirmLinkedInConnectionRequestedAction,
  recommendLinkedInConnectionAction,
  recommendLinkedInPostConnectionMessageAction,
} from "@/lib/actions/linkedin-connection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export type LinkedInConnectionView = {
  status: string;
  recommendedAt: string | null;
  requestApprovedAt: string | null;
  connectionRequestedAt: string | null;
  connectedAt: string | null;
  declinedAt: string | null;
  lastCheckedAt: string | null;
  nextEligibleMessageAt: string | null;
  waitDays: number;
  statusSource: string;
  statusCode: string | null;
  lastCheckResult: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
};

type ActionResult = { ok: boolean; reason?: string; code?: string };

export function LinkedInConnectionPanel({
  leadId,
  connection,
  messageDue,
}: {
  leadId: string;
  connection: LinkedInConnectionView | null;
  messageDue: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const status = connection?.status ?? "NOT_REQUESTED";
  const stopped = Boolean(connection?.stoppedAt);

  function run(action: () => Promise<ActionResult>) {
    start(async () => {
      const result = await action();
      setMessage(result.reason ?? (result.ok ? "Updated." : result.code ?? "Blocked."));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status === "CONNECTED" ? "default" : status === "DECLINED" || stopped ? "DISQUALIFIED" : "muted"}>
          {status}
        </Badge>
        {stopped ? <Badge tone="DISQUALIFIED">Stopped</Badge> : null}
        {status === "UNKNOWN" ? <Badge tone="WARM">UNKNOWN is not CONNECTED</Badge> : null}
        {status === "REQUESTED" ? <Badge tone="WARM">Invite pending — not connected</Badge> : null}
      </div>
      <p className="text-muted">
        Jarvis recommends a LinkedIn connection after Decision Maker PASS. You approve, you send the invite on
        LinkedIn, then you confirm REQUESTED here. Only an authorized status source may set CONNECTED. Jarvis will
        not log in, scrape, send the invite, or send a DM.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <Row label="Recommended" value={formatDate(connection?.recommendedAt)} />
        <Row label="Request approved" value={formatDate(connection?.requestApprovedAt)} />
        <Row label="Invite confirmed" value={formatDate(connection?.connectionRequestedAt)} />
        <Row label="Connected" value={formatDate(connection?.connectedAt)} />
        <Row label="Declined" value={formatDate(connection?.declinedAt)} />
        <Row label="Last status check" value={formatDate(connection?.lastCheckedAt)} />
        <Row label="Message eligible" value={formatDate(connection?.nextEligibleMessageAt)} />
        <Row label="Wait days" value={String(connection?.waitDays ?? 2)} />
        <Row label="Status source" value={connection?.statusSource || "none"} />
        <Row label="Last check" value={[connection?.lastCheckResult, connection?.statusCode].filter(Boolean).join(" · ") || "—"} />
      </dl>
      {connection?.stopReason ? <p className="text-amber-200">Stopped: {connection.stopReason}</p> : null}
      {!stopped ? (
        <div className="flex flex-wrap gap-2">
          {status === "NOT_REQUESTED" ? (
            <Button disabled={pending} onClick={() => run(() => recommendLinkedInConnectionAction(leadId))}>
              Recommend connect
            </Button>
          ) : null}
          {status === "RECOMMENDED" ? (
            <Button disabled={pending} onClick={() => run(() => approveLinkedInConnectionAction(leadId))}>
              Approve connection
            </Button>
          ) : null}
          {status === "REQUEST_APPROVED" ? (
            <Button
              disabled={pending}
              variant="outline"
              onClick={() => run(() => confirmLinkedInConnectionRequestedAction(leadId))}
            >
              I sent the invite
            </Button>
          ) : null}
          {status === "REQUESTED" || status === "UNKNOWN" ? (
            <Button
              disabled={pending}
              variant="outline"
              onClick={() => run(() => checkLinkedInConnectionStatusAction(leadId))}
            >
              Check connection status
            </Button>
          ) : null}
          {status === "CONNECTED" && messageDue ? (
            <Button disabled={pending} onClick={() => run(() => recommendLinkedInPostConnectionMessageAction(leadId))}>
              Recommend message draft
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
