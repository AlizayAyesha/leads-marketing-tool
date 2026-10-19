import { getCredentialPolicy, listPublicCredentials } from "@/lib/ai/credentials";
import { PageHeader } from "@/components/ui/page";
import { OpenAICredentialsPanel } from "@/components/settings/openai-credentials-panel";

export const dynamic = "force-dynamic";

export default async function SettingsAiPage() {
  const [credentials, policy] = await Promise.all([
    listPublicCredentials().catch(() => []),
    getCredentialPolicy().catch(() => ({
      policy: "ROUND_ROBIN" as const,
      failover: true,
      roundRobinIndex: 0,
    })),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Settings → AI"
        title="OpenAI Credentials"
        description="Add, test, enable, disable, and delete OpenAI keys. Agents never see the secrets."
      />
      <OpenAICredentialsPanel credentials={credentials} policy={policy} />
    </div>
  );
}
