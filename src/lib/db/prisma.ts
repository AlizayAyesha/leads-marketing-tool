import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/** Prisma's engine often fails on macOS `localhost` → IPv6 (`::1`). Force IPv4. */
export function resolveDatabaseUrl(raw = process.env.DATABASE_URL ?? "") {
  let url = raw.replace(/@localhost(?=[:/])/g, "@127.0.0.1");
  url = url.replace(/&host=\/tmp\b/, "").replace(/\?host=\/tmp&/, "?").replace(/\?host=\/tmp\b/, "");
  // Dev/Turbopack + parallel RSC queries need headroom; avoid pool timeouts under load.
  if (url && !/[?&]connect_timeout=/.test(url)) {
    url += `${url.includes("?") ? "&" : "?"}connect_timeout=15`;
  }
  if (url && !/[?&]pool_timeout=/.test(url)) {
    url += `${url.includes("?") ? "&" : "?"}pool_timeout=30`;
  }
  if (url && !/[?&]connection_limit=/.test(url)) {
    const limit = process.env.NODE_ENV === "production" ? 15 : 25;
    url += `${url.includes("?") ? "&" : "?"}connection_limit=${limit}`;
  }
  return url;
}

const databaseUrl = resolveDatabaseUrl();

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
