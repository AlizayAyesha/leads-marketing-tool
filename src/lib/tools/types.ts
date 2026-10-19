export type ToolAvailability = {
  available: boolean;
  reason: string;
};

export type ToolResult<T> = {
  ok: boolean;
  available: boolean;
  data?: T;
  error?: string;
};

export interface PlatformTool {
  readonly id: string;
  readonly platform: string;
  availability(): Promise<ToolAvailability>;
}
