import OpenAI from "openai";

import { resolveAIConfig } from "@/lib/ai/config";

/** The one place that constructs an AI SDK client (OpenAI or OpenRouter via OpenAI-compatible API). */
export function createAIClient(apiKey: string, options: { timeout?: number } = {}) {
  const config = resolveAIConfig();
  return new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    timeout: options.timeout ?? 60_000,
    defaultHeaders:
      config.provider === "openrouter"
        ? { "HTTP-Referer": process.env.APP_URL?.trim() || "http://localhost:3000", "X-Title": "Jarvis" }
        : undefined,
  });
}
