import {
  classifyOpenAIError,
  mayFailover,
  type OpenAIErrorCategory,
} from "@/lib/ai/errors";
import {
  remainingAttempts,
  selectCredential,
  type CredentialPolicy,
} from "@/lib/ai/policy";

export class AllOpenAICredentialsUnavailableError extends Error {
  readonly tried: string[];

  constructor(tried: string[] = []) {
    super("ALL_OPENAI_CREDENTIALS_UNAVAILABLE");
    this.name = "AllOpenAICredentialsUnavailableError";
    this.tried = tried;
  }
}

export type RuntimeCredential = {
  id: string;
  name: string;
  lastUsedAt?: Date | null;
};

export async function runCredentialedOperation<T>(input: {
  policy: CredentialPolicy;
  failover: boolean;
  roundRobinIndex: number;
  credentials: RuntimeCredential[];
  execute: (credentialId: string) => Promise<T>;
  classify?: (error: unknown) => OpenAIErrorCategory;
  onAttempt?: (event: {
    credentialId: string;
    success: boolean;
    category: OpenAIErrorCategory | null;
    error?: unknown;
  }) => Promise<void> | void;
  networkRetries?: number;
}): Promise<{
  result: T;
  credentialId: string;
  credentialName: string;
  nextIndex: number;
  tried: string[];
}> {
  const classify = input.classify ?? classifyOpenAIError;
  const networkRetries = input.networkRetries ?? 2;
  if (input.credentials.length === 0) {
    throw new AllOpenAICredentialsUnavailableError([]);
  }

  const selectable = input.credentials.map((item) => ({
    id: item.id,
    lastUsedAt: item.lastUsedAt ?? null,
  }));
  const tried: string[] = [];
  let rr = input.roundRobinIndex;
  let lastError: unknown = new AllOpenAICredentialsUnavailableError([]);

  while (tried.length < input.credentials.length) {
    const leftover = remainingAttempts(
      tried,
      input.credentials.map((item) => item.id),
    );
    const pool = selectable.filter((item) => leftover.includes(item.id));
    const picked = selectCredential(input.policy, pool, rr);
    if (!picked.id) break;
    rr = picked.nextIndex;
    const cred = input.credentials.find((item) => item.id === picked.id);
    if (!cred) break;
    tried.push(cred.id);

    let networkAttempt = 0;
    while (true) {
      try {
        const result = await input.execute(cred.id);
        await input.onAttempt?.({ credentialId: cred.id, success: true, category: null });
        return {
          result,
          credentialId: cred.id,
          credentialName: cred.name,
          nextIndex: rr,
          tried,
        };
      } catch (error) {
        const category = classify(error);
        lastError = error;
        const retryNetwork = category === "NETWORK_ERROR" && networkAttempt < networkRetries;
        if (!retryNetwork) {
          await input.onAttempt?.({
            credentialId: cred.id,
            success: false,
            category,
            error,
          });
        }
        if (retryNetwork) {
          networkAttempt += 1;
          continue;
        }
        if (!input.failover || !mayFailover(category)) {
          throw error;
        }
        break;
      }
    }
  }

  throw lastError instanceof AllOpenAICredentialsUnavailableError
    ? lastError
    : new AllOpenAICredentialsUnavailableError(tried);
}

export function publicCredentialFields() {
  return [
    "id",
    "name",
    "provider",
    "source",
    "hint",
    "enabled",
    "status",
    "lastTestedAt",
    "lastUsedAt",
    "lastErrorAt",
    "errorCount",
    "successCount",
    "createdAt",
  ] as const;
}
