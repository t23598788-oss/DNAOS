/**
 * POST/GET /api/gateway/observe/meta — Meta (Facebook Messenger + Instagram
 * Messaging) webhook ingress for the Integration Gateway's Observe Channel
 * (owner channel-expansion 2026-10-07). Same pattern as
 * /api/gateway/observe/{github,vercel,railway,line}: no requireAuth —
 * authenticity via Meta's own signature (X-Hub-Signature-256, HMAC-SHA256 of
 * the raw body with the App Secret) instead.
 *
 * GET  = Meta's subscription verification: connector verify_token match -> echo
 *        hub.challenge (403 otherwise; 503 when the Meta Connect record is absent).
 * POST = verify signature (401 on mismatch; 503 when the Meta Connect record is absent)
 *        -> normalize into canonical GatewayEvents (meta.ts adapter) ->
 *        publish to the event bus (observe channel only). Bus rejection = 500
 *        so Meta retries later; the evidence store upserts on event_id so the
 *        retry is idempotent (dedup by provider message id).
 *
 * Fail-closed on every path: no central credential = 503, disabled connector = 404, bad signature = 403/401,
 * unparseable JSON = 400, bus rejection = 500 — never a direct business write,
 * never a fallback. Channel surfaces: object "page" -> provider facebook,
 * object "instagram" -> provider instagram (both allowed by the
 * integration_gateway_events provider CHECK after migration
 * 20261007000001_propose_meta_gateway_providers — apply that migration before
 * enabling this endpoint against production, same release order as the LINE
 * provider migration).
 */
import { NextRequest, NextResponse } from "next/server";
import { normalizeMetaWebhook, verifyMetaSignature, metaVerifyChallenge } from "@/engines/integration-gateway/adapters/meta";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";
import { getConnectorByProvider } from "@/gateway/connectors";
import { MAX_WEBHOOK_BODY_BYTES } from "@/app/api/connectors/webhook/[slug]/_lib/webhookGate";

const PROVIDER_ID = "meta";

export async function GET(req: NextRequest) {
  const connector = await getConnectorByProvider(PROVIDER_ID);
  const verifyToken = connector?.secret?.verify_token;
  if (!connector || connector.auth_type !== "webhook" || typeof verifyToken !== "string" || !verifyToken) {
    return NextResponse.json({ error: "Meta webhook connector is not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const challenge = metaVerifyChallenge(
    {
      mode: url.searchParams.get("hub.mode"),
      verifyToken: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    },
    verifyToken,
  );
  if (challenge === null) {
    return NextResponse.json({ error: "invalid verification request" }, { status: 403 });
  }
  // Meta expects the raw hub.challenge value echoed back as the body
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const connector = await getConnectorByProvider(PROVIDER_ID);
  const appSecret = connector?.secret?.app_secret;
  if (!connector || connector.auth_type !== "webhook" || typeof appSecret !== "string" || !appSecret) {
    return NextResponse.json({ error: "Meta webhook connector is not configured" }, { status: 503 });
  }
  if (connector.enabled !== true || connector.status !== "connected") {
    return NextResponse.json({ error: "Meta connector is not enabled" }, { status: 404 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "unparseable JSON body" }, { status: 400 });
  }

  const { events, skipped } = normalizeMetaWebhook(payload);
  for (const event of events) {
    const result = await publish(supabaseAdmin(), event);
    // 500 on rejection = Meta retries; deterministic event_id keeps the retry idempotent
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accepted: events.length, skipped });
}
