/**
 * POST /api/gateway/observe/github — GitHub webhook ingress for the
 * Integration Gateway's Observe Channel. Not gated by requireAuth (GitHub
 * itself is the caller, same as every other external-provider webhook in
 * this app, e.g. supabase/functions/line-webhook-v2) — authenticity comes
 * from verifying the `x-hub-signature-256` HMAC instead. Never runs
 * anything: normalizes the payload (engines/integration-gateway/adapters/github.ts)
 * and publishes it to the event bus (channel "observe" only).
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyGithubSignature, normalizeGithubWebhook } from "@/engines/integration-gateway/adapters/github";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "GITHUB_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const githubEvent = req.headers.get("x-github-event") ?? "unknown";
  const deliveryId = req.headers.get("x-github-delivery");
  const payload = JSON.parse(rawBody);

  const event = normalizeGithubWebhook(githubEvent, payload, deliveryId);
  if (!event) {
    return NextResponse.json({ ok: true, skipped: `unhandled github event type: ${githubEvent}` });
  }

  const result = await publish(supabaseAdmin(), event);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });

  return NextResponse.json({ ok: true, event_id: event.event_id });
}
