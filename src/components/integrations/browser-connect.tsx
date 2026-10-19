"use client";

import { useState, useTransition } from "react";

import {
  connectBrowserAgentAction,
  disconnectBrowserAgentAction,
  openLinkedInSessionAction,
} from "@/lib/actions/integrations";
import { Button } from "@/components/ui/button";

export function BrowserConnect({ connected }: { connected: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Jarvis opens its own Chrome window, then loads LinkedIn (it should not stay on about:blank). Your everyday
        Chrome stays open. Google blocks attaching to that profile, which is why the debug-port error happened.
      </p>
      <p className="text-xs text-amber-200">
        If Connect says the profile is already in use, click Disconnect then Connect again (Jarvis will clear the stale
        window). If you briefly see about:blank, wait a second or click Open LinkedIn. Sign in in the Jarvis window if
        asked, then keep that window open.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await connectBrowserAgentAction();
              setMessage(
                result.ok
                  ? `${result.session.profile} attached. ${result.linkedin.message}`
                  : result.error,
              );
            })
          }
        >
          {connected ? "Reconnect" : "Connect"}
        </Button>
        <Button
          variant="outline"
          disabled={pending || !connected}
          onClick={() =>
            start(async () => {
              const result = await openLinkedInSessionAction();
              setMessage(result.ok ? result.message : result.error);
            })
          }
        >
          Open LinkedIn
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await disconnectBrowserAgentAction();
              setMessage(`Jarvis Chrome ${result.session.status}.`);
            })
          }
        >
          Disconnect
        </Button>
      </div>
      {message ? <p className="text-sm text-amber-100">{message}</p> : null}
    </div>
  );
}
