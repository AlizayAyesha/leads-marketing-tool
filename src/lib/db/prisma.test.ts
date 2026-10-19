import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDatabaseUrl } from "./prisma";

describe("resolveDatabaseUrl", () => {
  it("forces IPv4 and a connect timeout for local Prisma", () => {
    assert.equal(
      resolveDatabaseUrl("postgresql://jarvis:jarvis@localhost:5432/zar_jarvis?schema=public"),
      "postgresql://jarvis:jarvis@127.0.0.1:5432/zar_jarvis?schema=public&connect_timeout=15&pool_timeout=30&connection_limit=25",
    );
  });
});
