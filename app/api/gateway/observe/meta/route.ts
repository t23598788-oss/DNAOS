/**
 * POST/GET /api/gateway/observe/meta — Meta (Facebook Messenger + Instagram
 * Messaging) webhook ingress for the Integration Gateway's Observe Channel
 * (owner channel-expansion 2026-10-07). Same pattern as
 * /api/gateway/observe/{github,vercel,railway,line}: no requireAuth —
 * authenticity via Meta's own signature (X-Hub-Signature-256, HMAC-SHA256 of
 * the raw body with the App Secret) instead.
 *
 * GET  = Meta's subscription verification: hub.verify_token match -> echo
 *        hub.challenge (403 otherwise; 503 when META_VERIFY_TOKEN unset).
 * POST = verify signature (401 on mismatch; 503 when META_APP_SECRET unset)
 *        -> normalize into canonical GatewayEvents (meta.ts adapter) ->
 *        publish to the event bus (observe channel only). Bus rejection = 500
 *        so Meta retries later; the evidence store upserts on event_id so the
 *        retry is idempotent (dedup by provider message id).
 *
 * Fail-closed on every path: no env/secret = 503, bad signature = 403/401,
 * unparseable JSON = 400, bus rejection = 500 — never a direct business write,
 * never a fallback. Channel surfaces: object "page" -> provider facebook,
 * object "instagram" -> provider instagram (both allowed by the
 * integration_gateway_events provider CHECK after migration
 * 20261007000001_propose_meta_gateway_providers. That migration is marked
 * DRAFT / NOT APPLIED in source; verify the target project's migration ledger
 * and apply the reviewed migration before enabling this endpoint in production.
 */
import { NextRequest, NextResponse } from "next/server";
import { normalizeMetaWebhook, verifyMetaSignature, metaVerifyChallenge } from "@/engines/integration-gateway/adapters/meta";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";

export async function GET(req: NextRequest) {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ error: "META_VERIFY_TOKEN not configured" }, { status: 503 });
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
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "META_APP_SECRET not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
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
