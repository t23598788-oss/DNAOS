/**
 * POST /api/gateway/observe/line — inbound LINE webhook ingress for the
 * Integration Gateway's Observe Channel. Same pattern as
 * /api/gateway/observe/{github,vercel,railway}: no requireAuth, authenticity
 * via the provider's own signature (`x-line-signature`, HMAC-SHA256 base64 of
 * the raw body) instead. Never runs anything — each translated event is
 * published to the event bus (channel "observe" only).
 *
 * This is the ONE main-path entrance for inbound messaging-provider events.
 * The LINE Edge Function (supabase/functions/line-webhook-v2) remains the
 * provider-side receiver and forwards the raw body + signature here
 * (supabase/functions/_shared/connect-forward.ts) — so business logic never
 * has to know which provider delivered an event.
 *
 * Fail-closed on every path: secret not configured -> 503, bad/missing
 * signature -> 401, unparseable JSON -> 400, bus rejection -> 500.
 */
import { NextRequest, NextResponse } from "next/server";
import { normalizeLineWebhook, verifyLineSignature } from "@/engines/integration-gateway/adapters/line";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";

export async function POST(req: NextRequest) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "LINE_CHANNEL_SECRET not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");
  if (!verifyLineSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "unparseable JSON body" }, { status: 400 });
  }

  const { events, skipped } = normalizeLineWebhook(payload);
  const db = supabaseAdmin();
  for (const event of events) {
    const result = await publish(db, event);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accepted: events.length, skipped });
}
