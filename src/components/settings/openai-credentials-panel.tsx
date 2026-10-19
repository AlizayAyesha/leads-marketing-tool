"use client";

import { useState, useTransition } from "react";

import {
  addOpenAICredentialAction,
  deleteOpenAICredentialAction,
  migrateEnvOpenAICredentialAction,
  saveOpenAICredentialPolicyAction,
  setOpenAICredentialEnabledAction,
  testOpenAICredentialAction,
} from "@/lib/actions/openai-credentials";
import type { CredentialPolicyState, CredentialPublic } from "@/lib/ai/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type TestResult = {
  ok: boolean;
  name: string;
  status: string;
  model: string | null;
  timestamp: string;
  errorCategory: string | null;
};

function statusTone(status: string, enabled: boolean) {
  if (!enabled) return "muted";
  if (status === "HEALTHY" || status === "CONFIGURED" || status === "SUCCESS") return "default";
  if (status === "RATE_LIMITED") return "WARM";
  return "HOT";
}

function formatWhen(value: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

export function OpenAICredentialsPanel({
  credentials,
  policy,
}: {
  credentials: CredentialPublic[];
  policy: CredentialPolicyState;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [adding, setAdding] = useState(false);
  const connected = credentials.length > 0;
  const envCredential = credentials.find((item) => item.source === "env");

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-400/80">Settings → AI</p>
          <h2 className="font-[family-name:var(--font-syne)] text-lg">OpenAI Credentials</h2>
          <p className="mt-1 text-sm text-muted">
            Agents request LLM work through OpenAIProvider. Keys stay encrypted on the server.
          </p>
        </div>
        <Badge tone={connected ? "default" : "muted"}>{connected ? "CONNECTED" : "NOT CONFIGURED"}</Badge>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Selection policy</span>
          <select
            className="h-10 w-full rounded-lg border border-emerald-500/20 bg-black/40 px-3 text-sm"
            defaultValue={policy.policy}
            disabled={pending}
            onChange={(event) => {
              start(async () => {
                await saveOpenAICredentialPolicyAction({
                  policy: event.target.value as CredentialPolicyState["policy"],
                });
                setMessage(`Policy set to ${event.target.value}.`);
              });
            }}
          >
            <option value="ROUND_ROBIN">ROUND_ROBIN</option>
            <option value="SINGLE_PRIMARY">SINGLE_PRIMARY</option>
            <option value="LEAST_RECENTLY_USED">LEAST_RECENTLY_USED</option>
          </select>
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-emerald-400"
            defaultChecked={policy.failover}
            disabled={pending}
            onChange={(event) => {
              start(async () => {
                await saveOpenAICredentialPolicyAction({ failover: event.target.checked });
                setMessage(`Credential failover ${event.target.checked ? "ON" : "OFF"}.`);
              });
            }}
          />
          <span>Enable credential failover</span>
        </label>
      </div>

      {envCredential ? (
        <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-[family-name:var(--font-syne)]">Environment Credential</h3>
            <Badge>CONFIGURED</Badge>
          </div>
          <p className="text-sm text-muted">
            OPENAI_API_KEY is set and usable by OpenAIProvider. Value is never shown. Mask: {envCredential.hint}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const result = await migrateEnvOpenAICredentialAction();
                setMessage(
                  "error" in result && result.error
                    ? result.error
                    : "Copied the environment key into the credential manager. OPENAI_API_KEY is still the env fallback.",
                );
              });
            }}
          >
            Copy into credential manager
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {credentials.length === 0 ? (
          <p className="text-sm text-muted">No OpenAI credentials yet. Add a key or set OPENAI_API_KEY.</p>
        ) : (
          credentials.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/8 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-[family-name:var(--font-syne)]">{item.name}</p>
                  <p className="text-xs text-muted">
                    Provider: OpenAI · {item.source === "env" ? "environment" : "database"} · {item.hint}
                  </p>
                </div>
                <Badge tone={statusTone(item.status, item.enabled)}>
                  {item.enabled ? item.status : "DISABLED"}
                </Badge>
              </div>
              <p className="text-xs text-muted">
                Last used: {formatWhen(item.lastUsedAt)} · Successes: {item.successCount} · Errors: {item.errorCount}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      const result = await testOpenAICredentialAction(item.id);
                      setTestResult(result);
                      setMessage(null);
                    });
                  }}
                >
                  TEST
                </Button>
                {item.source === "database" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        start(async () => {
                          await setOpenAICredentialEnabledAction(item.id, !item.enabled);
                          setMessage(`${item.name} ${item.enabled ? "disabled" : "enabled"}.`);
                        });
                      }}
                    >
                      {item.enabled ? "DISABLE" : "ENABLE"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Delete credential ${item.name}? The encrypted secret is removed.`)) return;
                        start(async () => {
                          await deleteOpenAICredentialAction(item.id);
                          setMessage(`${item.name} deleted.`);
                          setTestResult(null);
                        });
                      }}
                    >
                      DELETE
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      {testResult ? (
        <div className="mt-4 rounded-xl border border-white/10 p-4 text-sm">
          <p>
            Test {testResult.status}: {testResult.name}
          </p>
          <p className="text-muted">
            {testResult.model} · {formatWhen(testResult.timestamp)}
            {testResult.errorCategory ? ` · ${testResult.errorCategory}` : ""}
          </p>
        </div>
      ) : null}

      {message ? <p className="mt-3 text-sm text-emerald-200">{message}</p> : null}

      {adding ? (
        <form
          className="mt-5 space-y-3 rounded-xl border border-emerald-500/20 p-4"
          action={(formData) => {
            start(async () => {
              const result = await addOpenAICredentialAction(formData);
              if ("error" in result && result.error) {
                setMessage(result.error);
                return;
              }
              setAdding(false);
              setMessage("Credential saved. The full key will not be shown again.");
            });
          }}
        >
          <div>
            <Label htmlFor="openai-name">Name</Label>
            <Input id="openai-name" name="name" required placeholder="Primary" />
          </div>
          <div>
            <Label htmlFor="openai-key">API Key</Label>
            <Input
              id="openai-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              required
              placeholder="sk-…"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" className="mt-5" onClick={() => setAdding(true)}>
          + Add OpenAI Key
        </Button>
      )}
    </section>
  );
}
