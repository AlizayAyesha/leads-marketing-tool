"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { connectBrowserAgentAction, disconnectBrowserAgentAction } from "@/lib/actions/integrations";
import { disconnectGoogleAction } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const OUTREACH_OAUTH_URL = "/api/google/oauth?gmail=1&next=outreach";

export function HomeConnections({
  chromeConnected,
  chromeProfile,
  googleEmail,
  gmailSendReady,
}: {
  chromeConnected: boolean;
  chromeProfile: string;
  googleEmail: string | null;
  gmailSendReady: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const autoLinkedInStarted = useRef(false);

  const connectLinkedInChrome = useCallback(() => {
    start(async () => {
      const result = await connectBrowserAgentAction();
      if (result.ok) {
        setMessage(
          `${result.session.profile} attached. ${result.linkedin.message}`,
        );
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  }, [router]);

  const connectOutreach = useCallback(() => {
    if (!gmailSendReady) {
      window.location.href = OUTREACH_OAUTH_URL;
      return;
    }
    connectLinkedInChrome();
  }, [connectLinkedInChrome, gmailSendReady]);

  useEffect(() => {
    if (autoLinkedInStarted.current) return;
    if (searchParams.get("connect") !== "linkedin") return;
    autoLinkedInStarted.current = true;

    const googleError = searchParams.get("google");
    const detail = searchParams.get("detail");
    if (googleError === "error" && detail) {
      setMessage(`Google connect failed: ${detail}`);
      router.replace("/");
      return;
    }

    connectLinkedInChrome();
    router.replace("/");
  }, [connectLinkedInChrome, router, searchParams]);

  const outreachReady = gmailSendReady && chromeConnected;

  return (
    <section className="glass mb-8 rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-syne)] text-lg">Setup</h2>
          <p className="text-sm text-muted">Google for email/sheets. Jarvis Chrome for LinkedIn and X.</p>
        </div>
        <Badge tone={outreachReady ? "HOT" : "muted"}>{outreachReady ? "ready to send" : "needs setup"}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={connectOutreach}>
          {pending ? "Connecting…" : outreachReady ? "Reconnect" : "Connect Google + Chrome"}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href="/integrations">All connections</a>
        </Button>
        {chromeConnected ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await disconnectBrowserAgentAction();
                setMessage("Chrome disconnected.");
                router.refresh();
              })
            }
          >
            Disconnect Chrome
          </Button>
        ) : null}
        {googleEmail ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await disconnectGoogleAction();
                setMessage("Google disconnected.");
                router.refresh();
              })
            }
          >
            Disconnect Google
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted">
        Google: {googleEmail ? `${googleEmail}${gmailSendReady ? " · Gmail ok" : " · reconnect for Gmail"}` : "not connected"}
        {" · "}
        Chrome: {chromeConnected ? `${chromeProfile} — sign into LinkedIn and x.com there` : "not connected"}
      </p>
      {message ? <p className="mt-2 text-sm text-emerald-200">{message}</p> : null}
    </section>
  );
}
