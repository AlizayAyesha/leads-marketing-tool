import "server-only";

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIGenerateOptions = {
  json?: boolean;
  temperature?: number;
  timeoutMs?: number;
};

export type AIGenerateResult = {
  text: string;
  provider: string;
  model: string;
};

export class AINotConfiguredError extends Error {
  constructor(provider = "AI") {
    super(`${provider} is not configured. Set the provider API key in .env.local.`);
    this.name = "AINotConfiguredError";
  }
}

export interface AIProvider {
  readonly id: string;
  readonly configured: boolean;
  generate(messages: AIMessage[], options?: AIGenerateOptions): Promise<AIGenerateResult>;
}

export async function generateJson<T>(
  provider: AIProvider,
  messages: AIMessage[],
  options?: AIGenerateOptions,
): Promise<{ data: T; raw: AIGenerateResult }> {
  const raw = await provider.generate(messages, { ...options, json: true });
  try {
    return { data: JSON.parse(raw.text) as T, raw };
  } catch {
    throw new Error(`${provider.id} returned invalid JSON`);
  }
}
