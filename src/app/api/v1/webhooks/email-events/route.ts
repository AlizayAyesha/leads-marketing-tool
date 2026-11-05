import { NextResponse } from "next/server";

import { applyDeliveryEvent, type DeliveryKind } from "@/lib/outreach/delivery";
import { verifyWebhookSignature } from "@/lib/outreach/unsubscribe-token";

export const auth = "public";

export async function POST(request: Request) {
  const secret = process.env.EMAIL_EVENT_WEBHOOK_SECRET?.trim() || "";
  if (!secret) {
    return NextResponse.json(
      { error: { code: "AUTH_NOT_CONFIGURED", message: "EMAIL_EVENT_WEBHOOK_SECRET is not set." } },
      { status: 503 },
    );
  }
  const raw = await request.text();
  if (!verifyWebhookSignature(secret, raw, request.headers.get("x-jarvis-signature"))) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Webhook signature was rejected." } }, { status: 401 });
  }
  let body: {
    provider?: string;
    providerEventId?: string;
    type?: string;
    email?: string;
    leadId?: string;
    draftId?: string;
    text?: string;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "JSON body required." } }, { status: 400 });
  }
  const type = (body.type ?? "").toUpperCase();
  if (type !== "BOUNCE" && type !== "UNSUBSCRIBE" && type !== "REPLY") {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "type must be bounce, unsubscribe, or reply." } }, { status: 400 });
  }
  if (!body.provider || !body.providerEventId) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "provider and providerEventId are required." } }, { status: 400 });
  }
  if (type === "REPLY") {
    if (!body.leadId || !body.text) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "reply events need leadId and text." } }, { status: 400 });
    }
    const { ingestReply } = await import("@/lib/outreach/engine");
    const result = await ingestReply({
      leadId: body.leadId,
      text: body.text,
      channel: "EMAIL",
      provider: body.provider,
      providerEventId: body.providerEventId,
    });
    return NextResponse.json(result);
  }
  const result = await applyDeliveryEvent({
    provider: body.provider,
    providerEventId: body.providerEventId,
    type: type as DeliveryKind,
    email: body.email,
    leadId: body.leadId,
    draftId: body.draftId,
  });
  return NextResponse.json(result);
}
