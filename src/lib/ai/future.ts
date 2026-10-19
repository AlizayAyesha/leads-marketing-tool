import "server-only";

import { AINotConfiguredError, type AIProvider } from "@/lib/ai/provider";

export class FutureAnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly configured = Boolean(process.env.ANTHROPIC_API_KEY);

  async generate(): Promise<never> {
    throw new AINotConfiguredError(
      "Anthropic is a reserved Phase 2+ provider. It is not wired in Phase 1.",
    );
  }
}

export class FutureGeminiProvider implements AIProvider {
  readonly id = "gemini";
  readonly configured = Boolean(process.env.GOOGLE_AI_API_KEY);

  async generate(): Promise<never> {
    throw new AINotConfiguredError(
      "Gemini is a reserved Phase 2+ provider. It is not wired in Phase 1.",
    );
  }
}
