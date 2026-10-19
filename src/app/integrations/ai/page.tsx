import { getCredentialPolicy, listPublicCredentials, openaiStatusSummary } from "@/lib/ai/credentials";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { OpenAICredentialsPanel } from "@/components/settings/openai-credentials-panel";

export const dynamic = "force-dynamic";

export default async function AiProvidersPage() {
  const [credentials, policy, summary] = await Promise.all([
    listPublicCredentials().catch(() => []),
    getCredentialPolicy().catch(() => ({
      policy: "ROUND_ROBIN" as const,
      failover: true,
      roundRobinIndex: 0,
    })),
    openaiStatusSummary().catch(() => null),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="AI providers"
        title="Model layer"
        description="Jarvis talks to AIProvider. OpenAI credentials are managed here. Anthropic and Gemini remain reserved."
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {[
          {
            name: "OpenAI",
            status: summary?.configured ? "connected" : "heuristic fallback",
            detail: summary
              ? `${summary.enabled} enabled · policy ${summary.policy}`
              : "Credential manager unavailable until Postgres is reachable.",
          },
          { name: "Anthropic", status: "reserved", detail: "FutureAnthropicProvider is not wired." },
          { name: "Gemini", status: "reserved", detail: "FutureGeminiProvider is not wired." },
        ].map((item) => (
          <article key={item.name} className="glass rounded-2xl p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-syne)]">{item.name}</h2>
              <Badge tone={item.status === "connected" ? "default" : "muted"}>{item.status}</Badge>
            </div>
            <p className="text-sm text-muted">{item.detail}</p>
          </article>
        ))}
      </div>
      <OpenAICredentialsPanel credentials={credentials} policy={policy} />
    </div>
  );
}
