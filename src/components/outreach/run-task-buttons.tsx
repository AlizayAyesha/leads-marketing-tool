"use client";

import Link from "next/link";

import {
  runLiveOutreachAction,
  runOutreachEngineAction,
  setLinkedInDailyOutreachAction,
  setTwitterDailyOutreachAction,
} from "@/lib/actions/outreach";
import { summarizeLiveRun } from "@/lib/outreach/live-run-copy";
import { Button } from "@/components/ui/button";
import { TaskRunBanner, useTaskRun } from "@/components/ui/task-run-status";

export function OutreachEngineRunButtons() {
  const task = useTaskRun();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={task.pending}
          onClick={() =>
            task.run(async () => {
              const report = await runLiveOutreachAction();
              return summarizeLiveRun(report);
            })
          }
        >
          {task.pending ? "Preparing…" : "Prepare outreach (no send)"}
        </Button>
        <Button
          variant="outline"
          disabled={task.pending}
          onClick={() =>
            task.run(async () => {
              const result = await runOutreachEngineAction();
              return `Draft-only engine finished. Scanned ${result.scanned} · PASS ${result.passed} · drafts ${result.drafts} · sent ${result.sent}.`;
            })
          }
        >
          {task.pending ? "Running…" : "Run engine (draft only)"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Send from Home →</Link>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        This page prepares drafts and toggles policy. Live LinkedIn / X / email send is on Home.
      </p>
      <TaskRunBanner phase={task.phase} lines={task.lines} />
    </div>
  );
}

export function LinkedInDailyRunButtons({
  enabled,
}: {
  enabled: boolean;
  canOperate: boolean;
}) {
  const task = useTaskRun();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={enabled ? "danger" : "default"}
          disabled={task.pending}
          onClick={() => {
            const nextOn = !enabled;
            task.run(async () => {
              const form = new FormData();
              form.set("linkedinDailyOutreach", nextOn ? "on" : "");
              const result = await setLinkedInDailyOutreachAction(form);
              if (!result.enabled) return "LinkedIn Daily is OFF.";
              return "LinkedIn Daily is ON. Send connections / messages from Home.";
            });
          }}
        >
          {task.pending ? "Running…" : enabled ? "Turn OFF" : "Turn ON"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Send from Home →</Link>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Policy toggle only. Live LinkedIn send (≤10 connections / messages) is on Home.
      </p>
      <TaskRunBanner phase={task.phase} lines={task.lines} />
    </div>
  );
}

export function TwitterDailyRunButtons({
  enabled,
}: {
  enabled: boolean;
  canOperate: boolean;
}) {
  const task = useTaskRun();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={enabled ? "danger" : "default"}
          disabled={task.pending}
          onClick={() => {
            const nextOn = !enabled;
            task.run(async () => {
              const form = new FormData();
              form.set("twitterDailyOutreach", nextOn ? "on" : "");
              const result = await setTwitterDailyOutreachAction(form);
              if (!result.enabled) return "X Daily is OFF.";
              return "X Daily is ON. Send DMs from Home.";
            });
          }}
        >
          {task.pending ? "Running…" : enabled ? "Turn OFF" : "Turn ON"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Send from Home →</Link>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Policy toggle only. Live X follow + DM send is on Home.
      </p>
      <TaskRunBanner phase={task.phase} lines={task.lines} />
    </div>
  );
}
