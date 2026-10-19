import { timingSafeEqual } from "node:crypto";

/**
 * Auth for /api/queue/process (it can trigger real sends, so it must never be open).
 * - If QUEUE_PROCESS_SECRET (or CRON_SECRET) is set: require it as `x-queue-secret`
 *   or `Authorization: Bearer <secret>`.
 * - If no secret is configured: allow loopback callers only (no proxy forwarding headers).
 */
export function queueSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.QUEUE_PROCESS_SECRET?.trim() || env.CRON_SECRET?.trim() || "";
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isLoopbackHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function isQueueRequestAuthorized(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const secret = queueSecret(env);
  if (secret) {
    const header = request.headers.get("x-queue-secret")?.trim() ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
    return (header !== "" && safeEqual(header, secret)) || (bearer !== "" && safeEqual(bearer, secret));
  }
  if (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || request.headers.get("forwarded")) {
    return false;
  }
  try {
    return isLoopbackHost(new URL(request.url).hostname) && isLoopbackHost((request.headers.get("host") ?? "").split(":")[0] || "localhost");
  } catch {
    return false;
  }
}
