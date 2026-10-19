import type { Capability } from "@/lib/brain/capabilities";

export type PlatformTask = {
  type: string;
  payload?: Record<string, unknown>;
};

export type PlatformAgentResult = {
  ok: boolean;
  output: unknown;
  error?: string;
  unavailable?: boolean;
};

export interface PlatformAgent {
  id: string;
  name: string;
  platform: string;
  capabilities: readonly Capability[];
  permissions: string[];
  execute(task: PlatformTask): Promise<PlatformAgentResult>;
}
