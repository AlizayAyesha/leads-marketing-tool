"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function SignInPanel({ devEnabled }: { devEnabled: boolean }) {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");

  async function exchange(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/v1/auth/session", {
      method: "POST",
      headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json" },
      body: "{}",
    });
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!response.ok) {
      setMessage(body?.error?.message || "The access token was rejected.");
      return;
    }
    window.location.href = "/";
  }

  async function devSession() {
    setMessage("");
    const response = await fetch("/api/v1/auth/dev-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = (await response.json().catch(() => null)) as { error?: { message?: string }; notice?: string } | null;
    if (!response.ok) {
      setMessage(body?.error?.message || "Development session is not available.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Zar Labs login</p>
      <h1 className="mt-2 font-[family-name:var(--font-syne)] text-3xl">Sign in with the same Zar Labs account</h1>
      <p className="mt-3 text-sm text-muted">
        Jarvis does not have its own password. The Zar Labs dashboard signs you in with Supabase (Google or email) and
        sends that access token here. Jarvis verifies the signature, issuer, and audience, then keeps a short HttpOnly
        session. A user id typed into the browser is ignored.
      </p>
      <form onSubmit={exchange} className="mt-6 space-y-3">
        <div>
          <Label htmlFor="accessToken">Supabase access token</Label>
          <Input id="accessToken" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
        </div>
        <Button type="submit">Continue</Button>
      </form>
      {devEnabled ? (
        <div className="mt-6 rounded-xl border border-amber-500/30 p-4 text-sm">
          <p className="text-amber-100">Local development only. This does not exist in production.</p>
          <Button type="button" className="mt-3" variant="outline" onClick={() => void devSession()}>
            Continue as local operator
          </Button>
        </div>
      ) : null}
      {message ? <p className="mt-4 text-sm text-red-300">{message}</p> : null}
    </div>
  );
}
