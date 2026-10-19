declare module "playwright" {
  export const chromium: {
    launchPersistentContext: (userDataDir: string, options?: Record<string, unknown>) => Promise<unknown>;
    connectOverCDP: (endpoint: string) => Promise<unknown>;
  };
}
