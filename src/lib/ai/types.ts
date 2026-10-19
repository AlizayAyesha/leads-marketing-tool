import type { CredentialPolicy } from "@/lib/ai/policy";

export type CredentialPublic = {
  id: string;
  name: string;
  provider: "OPENAI";
  source: "env" | "database";
  hint: string | null;
  enabled: boolean;
  status: string;
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  lastErrorAt: string | null;
  errorCount: number;
  successCount: number;
  createdAt: string | null;
};

export type CredentialPolicyState = {
  policy: CredentialPolicy;
  failover: boolean;
  roundRobinIndex: number;
};
