import "server-only";

import { getEnv } from "@/lib/env";
import {
  refreshCredentialCache,
  runWithOpenAICredential,
  openaiCredentialSnapshot,
} from "@/lib/ai/credentials";
import {
  AINotConfiguredError,
  type AIGenerateOptions,
  type AIGenerateResult,
  type AIMessage,
  type AIProvider,
} from "@/lib/ai/provider";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  private model: string;

  constructor() {
    this.model = getEnv().openaiModel;
    void refreshCredentialCache();
  }

  get configured() {
    return openaiCredentialSnapshot();
  }

  async generate(
    messages: AIMessage[],
    options: AIGenerateOptions = {},
  ): Promise<AIGenerateResult> {
    await refreshCredentialCache();
    if (!this.configured) throw new AINotConfiguredError("OpenAI");

    const { result } = await runWithOpenAICredential({
      operation: "generate",
      model: this.model,
      execute: async (client) =>
        client.chat.completions.create(
          {
            model: this.model,
            temperature: options.temperature ?? 0.2,
            response_format: options.json ? { type: "json_object" } : undefined,
            messages,
          },
          { timeout: options.timeoutMs ?? 60_000 },
        ),
      readUsage: (response) =>
        response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : null,
    });

    const text = result.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("OpenAI returned an empty response");

    return { text, provider: this.id, model: this.model };
  }

  async stream(messages: AIMessage[], options: AIGenerateOptions = {}) {
    await refreshCredentialCache();
    if (!this.configured) throw new AINotConfiguredError("OpenAI");

    const { result } = await runWithOpenAICredential({
      operation: "stream",
      model: this.model,
      execute: (client) =>
        client.chat.completions.create({
          model: this.model,
          temperature: options.temperature ?? 0.2,
          messages,
          stream: true,
        }),
    });
    return result;
  }

  async embed(input: string, model = "text-embedding-3-small") {
    await refreshCredentialCache();
    if (!this.configured) throw new AINotConfiguredError("OpenAI");

    const { result } = await runWithOpenAICredential({
      operation: "embed",
      model,
      execute: (client) => client.embeddings.create({ model, input }),
      readUsage: (response) =>
        response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : null,
    });
    return result;
  }
}
