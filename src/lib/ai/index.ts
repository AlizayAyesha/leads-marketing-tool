import "server-only";

import { OpenAIProvider } from "@/lib/ai/openai";
import type { AIProvider } from "@/lib/ai/provider";

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  cached ??= new OpenAIProvider();
  return cached;
}

export { OpenAIProvider } from "@/lib/ai/openai";
