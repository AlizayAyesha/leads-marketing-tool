import { AsyncLocalStorage } from "node:async_hooks";

import type { Principal } from "@/lib/auth/types";

export const principalStorage = new AsyncLocalStorage<Principal>();

export function currentPrincipal() {
  return principalStorage.getStore() ?? null;
}
