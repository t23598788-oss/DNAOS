/**
 * POST /api/gateway/observe/vercel — Vercel deployment webhook ingress for
 * the Integration Gateway's Observe Channel. Same pattern as
 * /api/gateway/observe/github: no requireAuth, authenticity via HMAC
 * signature (`x-vercel-signature`) instead. Never runs anything.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyVercelSignature, normalizeVercelWebhook } from "@/engines/integration-gateway/adapters/vercel";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";

export async function POST(req: NextRequest) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "VERCEL_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-vercel-signature");
  if (!verifyVercelSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const event = normalizeVercelWebhook(payload);
  if (!event) {
    return NextResponse.json({ ok: true, skipped: `unhandled vercel event type: ${payload?.type ?? "unknown"}` });
  }

  const result = await publish(supabaseAdmin(), event);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });

  return NextResponse.json({ ok: true, event_id: event.event_id });
}
