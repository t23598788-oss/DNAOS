/**
 * POST /api/gateway/observe/railway — Railway webhook ingress for the
 * Integration Gateway's Observe Channel. Same pattern as
 * /api/gateway/observe/vercel and /api/gateway/observe/github: no
 * requireAuth, never runs anything — normalizes the payload
 * (engines/integration-gateway/adapters/railway.ts) and publishes it to the
 * event bus (channel "observe" only).
 *
 * Verification differs from Vercel/GitHub by upstream design: Railway does
 * NOT sign its webhook payloads (docs.railway.com/observability/webhooks —
 * "Webhook payloads are not cryptographically signed"). The docs' prescribed
 * verification is to include a secret in the configured webhook URL and
 * reject any request that does not carry it. So the URL the owner registers
 * on Railway is:
 *
 *   https://<host>/api/gateway/observe/railway?key=<RAILWAY_WEBHOOK_SECRET>
 *
 * This route compares that `key` query parameter against the
 * RAILWAY_WEBHOOK_SECRET env var in constant time, fail-closed on every
 * path: missing env → 503 (same as the Vercel/GitHub routes), missing or
 * wrong secret → 401, unparseable JSON → 400. Unhandled event types return
 * ok with a skipped note (same contract as the sibling routes).
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { normalizeRailwayWebhook } from "@/engines/integration-gateway/adapters/railway";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";

function secretMatches(provided: string | null, secret: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAILWAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "RAILWAY_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  // Railway's prescribed sender verification: secret carried in the
  // registered webhook URL (query param `key`), not a signed header.
  if (!secretMatches(req.nextUrl.searchParams.get("key"), secret)) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const event = normalizeRailwayWebhook(payload);
  if (!event) {
    const type = (payload as { type?: string } | null)?.type ?? "unknown";
    return NextResponse.json({ ok: true, skipped: `unhandled railway event type: ${type}` });
  }

  const result = await publish(supabaseAdmin(), event);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });

  return NextResponse.json({ ok: true, event_id: event.event_id });
}
