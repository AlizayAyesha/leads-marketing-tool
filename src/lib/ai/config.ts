/**
 * Central AI provider configuration.
 *
 * Jarvis talks to any OpenAI-compatible chat API. Two providers are supported out of the box:
 *   - openrouter (recommended default; has free ":free" models) → https://openrouter.ai/api/v1
 *   - openai                                                      → https://api.openai.com/v1
 *
 * Env:
 *   AI_PROVIDER=openrouter|openai   (default: openrouter, or openai if only OPENAI_API_KEY is set)
 *   OPENROUTER_API_KEY / OPENAI_API_KEY
 *   AI_MODEL                         (optional; per-provider default below)
 *   AI_BASE_URL                      (optional override for any OpenAI-compatible endpoint)
 *
 * When no key is configured, agents fall back to the labeled heuristic mode.
 */
export type AIProviderId = "openai" | "openrouter";

export type AIConfig = {
  provider: AIProviderId;
  apiKey: string;
  model: string;
  baseURL: string | undefined;
  label: string;
};

export const DEFAULT_MODELS: Record<AIProviderId, string> = {
  openai: "gpt-4o-mini",
  // A free OpenRouter router model. Change AI_MODEL to any model id ending in ":free" or a paid model.
  openrouter: "openrouter/free",
};

const BASE_URLS: Record<AIProviderId, string | undefined> = {
  openai: undefined,
  openrouter: "https://openrouter.ai/api/v1",
};

function read(env: Record<string, string | undefined>, name: string) {
  return env[name]?.trim() || "";
}

export function resolveAIConfig(env: Record<string, string | undefined> = process.env): AIConfig {
  const raw = read(env, "AI_PROVIDER").toLowerCase();
  const openaiKey = read(env, "OPENAI_API_KEY");
  const openrouterKey = read(env, "OPENROUTER_API_KEY");
  let provider: AIProviderId;
  if (raw === "openai" || raw === "openrouter") provider = raw;
  else provider = !openrouterKey && openaiKey ? "openai" : "openrouter";

  const apiKey = provider === "openrouter" ? openrouterKey : openaiKey;
  const model = read(env, "AI_MODEL") || read(env, "OPENAI_MODEL") || DEFAULT_MODELS[provider];
  const baseURL = read(env, "AI_BASE_URL") || BASE_URLS[provider];
  return {
    provider,
    apiKey,
    model,
    baseURL,
    label: provider === "openrouter" ? "OpenRouter" : "OpenAI",
  };
}

export function aiKeyEnvName(provider: AIProviderId) {
  return provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
}
