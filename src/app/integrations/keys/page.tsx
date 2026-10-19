import { integrationStatus } from "@/lib/env";
import { apifyTokenPublicStatus } from "@/lib/secrets";
import { openaiStatusSummary } from "@/lib/ai/credentials";
import { saveApifyTokenAction, savePdlApiKeyAction } from "@/lib/actions/integrations";
import { pdlTokenPublicStatus } from "@/lib/pdl/secrets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const env = integrationStatus();
  const [apify, openai, pdl] = await Promise.all([
    apifyTokenPublicStatus().catch(() => ({
      configured: false,
      source: null as "env" | "settings" | null,
      hint: null as string | null,
    })),
    openaiStatusSummary().catch(() => null),
    pdlTokenPublicStatus().catch(() => ({
      configured: false,
      source: null as "env" | "settings" | null,
      hint: null as string | null,
    })),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="API keys"
        title="Server-side secrets"
        description="Tokens are stored on the server or in environment variables. They are never sent back to the browser in full."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-syne)]">Apify</h2>
            <Badge tone={apify.configured ? "default" : "muted"}>
              {apify.configured ? apify.source : "missing"}
            </Badge>
          </div>
          <p className="mb-4 text-sm text-muted">
            {apify.configured
              ? `Configured ${apify.source === "env" ? "via APIFY_API_TOKEN" : "in settings"} ${apify.hint}`
              : "Paste a token or set APIFY_API_TOKEN. Env wins if both exist."}
          </p>
          <form action={saveApifyTokenAction} className="space-y-3">
            <div>
              <Label htmlFor="token">Apify API token</Label>
              <Input id="token" name="token" type="password" autoComplete="off" placeholder="apify_api_…" />
            </div>
            <Button type="submit">Save token</Button>
          </form>
        </article>
        <article className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-syne)]">People Data Labs</h2>
            <Badge tone={pdl.configured ? "default" : "muted"}>
              {pdl.configured ? pdl.source : "missing"}
            </Badge>
          </div>
          <p className="mb-4 text-sm text-muted">
            {pdl.configured
              ? `Configured ${pdl.source === "env" ? "via PDL_API_KEY" : "in settings"} ${pdl.hint}`
              : "Licensed person enrichment and search. Env wins if both exist. Jarvis will not log into LinkedIn."}
          </p>
          <form action={savePdlApiKeyAction} className="space-y-3">
            <div>
              <Label htmlFor="pdlToken">PDL API key</Label>
              <Input id="pdlToken" name="pdlToken" type="password" autoComplete="off" placeholder="pdl_…" />
            </div>
            <Button type="submit">Save key</Button>
          </form>
        </article>
        <article className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-syne)]">OpenAI</h2>
            <Badge tone={openai?.configured ? "default" : "muted"}>
              {openai?.configured ? "managed" : "heuristic"}
            </Badge>
          </div>
          <p className="mb-3 text-sm text-muted">
            Additional keys belong in Settings → AI, not extra environment variables.
            {openai?.configured ? ` ${openai.enabled} enabled · policy ${openai.policy}.` : ""}
          </p>
          <Button asChild variant="outline">
            <Link href="/settings/ai">Open OpenAI credentials</Link>
          </Button>
        </article>
        <article className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-syne)]">Google OAuth</h2>
            <Badge tone={env.google.configured ? "default" : "muted"}>
              {env.google.configured ? "env" : "pending"}
            </Badge>
          </div>
          <p className="text-sm text-muted">{env.google.detail}</p>
        </article>
      </div>
    </div>
  );
}
