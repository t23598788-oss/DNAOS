import type { CoreEventEnvelope } from "./core-event.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

type IncomingLineEvent = {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  replyToken?: string;
  message?: Record<string, unknown>;
  postback?: Record<string, unknown>;
  deliveryContext?: { isRedelivery?: boolean };
};

type LinePayload = { destination?: string; events?: IncomingLineEvent[] };

function normalizedEventType(event: IncomingLineEvent): string {
  if (event.type === "message") {
    const kind = event.message?.type;
    return kind === "image" || kind === "file" || kind === "audio" || kind === "video"
      ? "document.received"
      : kind === "location" ? "location.received" : "message.received";
  }
  if (event.type === "follow" || event.type === "unfollow") return "identity.signal.received";
  if (event.type === "postback") return "interaction.received";
  return "provider.event.received";
}

async function stableFallbackId(event: IncomingLineEvent): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

/** Convert LINE adapter data to the shared envelope before it leaves Supabase. */
export async function normalizeLineEvents(payload: LinePayload): Promise<CoreEventEnvelope[]> {
  const events: CoreEventEnvelope[] = [];
  for (const event of payload.events ?? []) {
    const sourceEventId = event.webhookEventId ??
      (typeof event.message?.id === "string" ? event.message.id : null) ??
      await stableFallbackId(event);
    const actorId = event.source?.userId ?? event.source?.groupId ?? event.source?.roomId ?? null;
    const occurredAt = typeof event.timestamp === "number"
      ? new Date(event.timestamp).toISOString()
      : new Date().toISOString();

    // Preserve only fields used by the conversation processor. In particular,
    // LINE replyToken, delivery metadata, and unrelated raw provider fields do
    // not cross the queue boundary.
    const safeSource = event.source ? {
      type: event.source.type,
      ...(event.source.userId ? { userId: event.source.userId } : {}),
      ...(event.source.groupId ? { groupId: event.source.groupId } : {}),
      ...(event.source.roomId ? { roomId: event.source.roomId } : {}),
    } : undefined;
    const safeMessage = event.message ? {
      ...(typeof event.message.type === "string" ? { type: event.message.type } : {}),
      ...(typeof event.message.id === "string" ? { id: event.message.id } : {}),
      ...(typeof event.message.text === "string" ? { text: event.message.text } : {}),
    } : undefined;

    events.push({
      event_id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
      idempotency_key: `line:${sourceEventId}`,
      schema_version: "1.0.0",
      event_type: normalizedEventType(event),
      source: "line",
      source_event_id: sourceEventId,
      tenant_id: null,
      actor: { type: actorId ? "user" : "provider", id: actorId },
      correlation: { parent_event_id: null },
      occurred_at: occurredAt,
      recorded_at: new Date().toISOString(),
      data: {
        channel_destination: payload.destination ?? null,
        ...(event.type === "message" && event.message?.type === "text"
          ? { capability_id: "conversation.answer" }
          : {}),
        // Minimal provider-specific fields required by the current response
        // engine; never forward replyToken or other raw webhook properties.
        line_event: {
          type: event.type,
          ...(safeSource ? { source: safeSource } : {}),
          ...(safeMessage ? { message: safeMessage } : {}),
        },
      },
    });
  }
  return events;
}

/** Submit a batch to the generic Main Server queue ingress. */
export async function enqueueCoreEvents(events: CoreEventEnvelope[]): Promise<boolean> {
  if (events.length === 0) return true;
  const appUrl = Deno.env.get("DNA_OS_APP_URL")?.replace(/\/+$/, "");
  const secret = Deno.env.get("CORE_EVENTS_INGEST_SECRET");
  if (!appUrl || !secret) return false;

  try {
    const response = await fetch(`${appUrl}/api/internal/core-events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-core-events-secret": secret,
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(2500),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
