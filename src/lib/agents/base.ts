import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai";
import { refreshCredentialCache } from "@/lib/ai/credentials";
import { generateJson } from "@/lib/ai/provider";
import { AINotConfiguredError, type AIMessage } from "@/lib/ai/provider";
import type { AgentResult, SpecializedAgent } from "@/lib/agents/types";

export abstract class BaseAgent implements SpecializedAgent {
  abstract slug: string;
  abstract name: string;
  abstract description: string;

  protected async loadPrompt(fallback: string) {
    const row = await prisma.prompt.findUnique({
      where: { agentSlug: this.slug },
    });
    return row?.content || fallback;
  }

  protected async askJson<T>(
    prompt: string,
    user: string,
  ): Promise<{
    data: T | null;
    mode: "openai" | "heuristic";
    error?: string;
    provider?: string;
    model?: string;
  }> {
    await refreshCredentialCache();
    const provider = getAIProvider();
    if (!provider.configured) {
      return { data: null, mode: "heuristic", error: "AI provider not configured" };
    }
    try {
      const messages: AIMessage[] = [
        { role: "system", content: prompt },
        { role: "user", content: user },
      ];
      const { data, raw } = await generateJson<T>(provider, messages, {
        temperature: 0.2,
        timeoutMs: 60_000,
      });
      return { data, mode: "openai", provider: raw.provider, model: raw.model };
    } catch (error) {
      if (error instanceof AINotConfiguredError) {
        return { data: null, mode: "heuristic", error: error.message };
      }
      return {
        data: null,
        mode: "heuristic",
        error: error instanceof Error ? error.message : "AI generation failed",
      };
    }
  }

  abstract execute(...args: Parameters<SpecializedAgent["execute"]>): Promise<AgentResult>;
}
