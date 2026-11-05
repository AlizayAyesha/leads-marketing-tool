import { NextResponse } from "next/server";

import { applyDeliveryEvent, unsubscribeEventId } from "@/lib/outreach/delivery";
import { verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe-token";

export const auth = "public";

function page(title: string, body: string, token = "") {
  const form = token
    ? `<form method="post" action="/api/v1/unsubscribe"><input type="hidden" name="token" value="${token.replace(/"/g, "")}"/><button type="submit">Unsubscribe</button></form>`
    : "";
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p>${form}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = verifyUnsubscribeToken(token);
  if (!claims) return page("Unsubscribe link is not valid", "The link is missing, expired, or the unsubscribe secret is not configured.");
  return page("Confirm unsubscribe", `${claims.email} will be suppressed and follow-ups will stop. This page does not unsubscribe on its own.`, token);
}

async function perform(token: string) {
  const claims = verifyUnsubscribeToken(token);
  if (!claims) {
    return NextResponse.json({ error: { code: "INVALID_TOKEN", message: "Unsubscribe token was rejected." } }, { status: 400 });
  }
  const result = await applyDeliveryEvent({
    provider: "jarvis-unsubscribe",
    providerEventId: unsubscribeEventId(token),
    type: "UNSUBSCRIBE",
    email: claims.email,
    leadId: claims.leadId,
    tenantId: claims.tenantId,
  });
  return NextResponse.json({ ok: true, duplicate: result.duplicate, stopped: "stopped" in result ? result.stopped : 0 });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const token = String(form.get("token") ?? "");
    const oneClick = String(form.get("List-Unsubscribe") ?? "");
    if (oneClick && oneClick !== "One-Click" && !token) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Unexpected one-click body." } }, { status: 400 });
    }
    const urlToken = new URL(request.url).searchParams.get("token") ?? token;
    return perform(urlToken);
  }
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = body.token || new URL(request.url).searchParams.get("token") || "";
  return perform(token);
}
