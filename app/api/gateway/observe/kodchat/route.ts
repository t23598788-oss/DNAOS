import { NextResponse, type NextRequest } from "next/server";
import { requireProviderConnector } from "@/core/connector-loader";
import { kodChatCoreEvents, normalizeKodChatWebhook, verifyKodChatWebhookSignature } from "@/engines/integration-gateway/adapters/kodchat";
import { enqueueCoreEvents } from "@/engines/integration-gateway/coreQueue";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { supabaseAdmin } from "@/services/supabase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

/** POST /api/gateway/observe/kodchat — Kob Chat Bot API v1 webhook ingress.
 * Configure this absolute URL in the bot's webhook settings. */
export async function POST(request: NextRequest) {
  const db = supabaseAdmin();
  let connector;
  try {
    connector = await requireProviderConnector(db, "kodchat", "integration-gateway.kodchat.observe");
  } catch {
    return NextResponse.json({ status: "error", error_code: "CONNECTOR_NOT_ENABLED" }, { status: 503 });
  }

  const webhookSecret = typeof connector.secret.webhook_secret === "string" ? connector.secret.webhook_secret : "";
  if (!webhookSecret) return NextResponse.json({ status: "error", error_code: "CREDENTIAL_MISSING" }, { status: 503 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ status: "error", error_code: "INVALID_PAYLOAD" }, { status: 413 });
  }
  const signatureHeader = String(connector.config.signature_header ?? "X-Kob-Signature");
  const signatureEncoding = connector.config.signature_encoding === "hex" ? "hex" : "base64";
  const signaturePrefix = typeof connector.config.signature_prefix === "string" ? connector.config.signature_prefix : "";
  if (!verifyKodChatWebhookSignature(rawBody, request.headers.get(signatureHeader), webhookSecret, {
    signatureHeader,
    signatureEncoding,
    signaturePrefix,
  })) {
    return NextResponse.json({ status: "error", error_code: "AUTH_FAILED" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: "error", error_code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const normalized = normalizeKodChatWebhook(payload);
  const transientCoreEvents = kodChatCoreEvents(payload);
  const coreEventsBySourceId = new Map(transientCoreEvents.map((event) => [event.source_event_id, event]));
  let duplicateCount = 0;
  const newGatewayEvents = [] as typeof normalized.events;
  const newSourceIds = new Set<string>();
  for (const event of normalized.events) {
    // Kod Chat sends each webhook once, but signed requests can still be
    // replayed. Avoid redispatching an event already durably recorded.
    const prior = await db.from("integration_gateway_events").select("event_id").eq("event_id", event.event_id).maybeSingle();
    if (prior.error) return NextResponse.json({ status: "error", error_code: "EVENT_DEDUP_CHECK_FAILED" }, { status: 500 });
    if (prior.data) { duplicateCount++; continue; }
    newGatewayEvents.push(event);
    const eventSourceId = typeof event.evidence.webhook_event_id === "string" ? event.evidence.webhook_event_id : null;
    if (eventSourceId) newSourceIds.add(eventSourceId);
  }

  const queueEvents = [...newSourceIds].map((id) => coreEventsBySourceId.get(id)).filter((event) => event !== undefined);
  if (!await enqueueCoreEvents(queueEvents)) {
    return NextResponse.json({ status: "error", error_code: "CORE_QUEUE_UNAVAILABLE" }, { status: 503 });
  }

  let observeFailed = 0;
  for (const event of newGatewayEvents) {
    const result = await publish(db, event);
    if (!result.ok) {
      observeFailed++;
    }
  }

  return NextResponse.json({ status: "success", data: { accepted: queueEvents.length, observed: newGatewayEvents.length - observeFailed, skipped: normalized.skipped + duplicateCount } });
}
