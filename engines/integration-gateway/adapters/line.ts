/**
 * Integration Gateway — LINE Adapter (capability A, 2026-09-23).
 *
 * This is the ONE place allowed to read a raw LINE webhook payload. It runs at
 * the Provider Adapter boundary and does protocol-level work only:
 *   - signature verification (LINE's real scheme: HMAC-SHA256 of the raw body,
 *     base64-encoded, header `x-line-signature`)
 *   - translation of each inbound LINE event into the canonical GatewayEvent
 *
 * What it deliberately does NOT do (per the provider-retreat line):
 *   - no business table access, no business rule, no money, no DB client
 *   - no raw message text / reply token / credential in the evidence payload —
 *     the evidence contract is a KEY WHITELIST (see EVIDENCE_KEYS), so the
 *     boundary can never leak customer content or a token into a core table
 *
 * Observe Channel only, exactly like every other adapter in this folder:
 * every event carries requested_effect: "none" and action: "observe".
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { GatewayCapability, GatewayEvent } from "../contracts/event";

/** LINE signs with HMAC-SHA256 and sends the base64 digest in x-line-signature. */
export function verifyLineSignature(rawBody: string, signatureHeader: string | null, channelSecret: string): boolean {
  if (!signatureHeader || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Anchor fields (project_id, document_group_id, customer_company_id,
// customer_site_id) are not sent by LINE itself. When present on the
// incoming event object (e.g. a simulator or an internal bridge), the
// adapter forwards them so order-translator can create an anchored
// customer_order without falling back to a previous order's anchors.

/**
 * The exact evidence keys this adapter may emit. Anything not listed here must
 * not appear — a raw text body, a reply token, or a channel secret has no key
 * to travel under, so it cannot reach integration_gateway_events by accident.
 */
export const EVIDENCE_KEYS: readonly string[] = [
  "webhook_event_id",
  "event_type",
  "source_type",
  // WAVE 2 — the provider-side identity of the sender. Without it a LINE event
  // could not be attributed downstream at all (Meta already kept sender_id),
  // which made "who sent this" unanswerable from the central event.
  "sender_id",
  // ORDER ANCHORS — forwarded verbatim when the incoming event carries them.
  "customer_company_id",
  "customer_site_id",
  "document_group_id",
  "project_id",
  "message_type",
  "has_media",
  "is_redelivery",
  "channel_destination",
  "provider_timestamp",
];

/** Business meaning of one inbound LINE event, expressed provider-agnostically. */
export function capabilityForInboundEvent(eventType: string, messageType: string | null): GatewayCapability | null {
  if (eventType === "message") {
    if (messageType === "image" || messageType === "file") return "document.received";
    if (messageType === "location") return "location.received";
    // text / audio / sticker / video / anything else a messaging provider can
    // deliver as a message — one verb, not one verb per provider message type.
    return "message.received";
  }
  if (eventType === "follow" || eventType === "unfollow") return "identity.signal.received";
  if (eventType === "postback") return "interaction.received";
  return null;
}

interface LineInboundEvent {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  deliveryContext?: { isRedelivery?: boolean };
  source?: { type?: string; userId?: string };
  message?: { type?: string; id?: string };
  project_id?: string | null;
  document_group_id?: string | null;
  customer_company_id?: string | null;
  customer_site_id?: string | null;
}

function newEventId(webhookEventId: string | undefined, index: number, timestamp: number | undefined): string {
  return `EVT-line-${webhookEventId ?? `${timestamp ?? 0}-${index}`}`;
}

/**
 * Normalizes a whole LINE webhook payload (LINE batches `events[]`) into
 * GatewayEvents. Events whose type this boundary does not translate yet are
 * skipped — reported as `skipped`, never invented into a capability.
 */
export function normalizeLineWebhook(payload: unknown): { events: GatewayEvent[]; skipped: number } {
  const body = (payload ?? {}) as { destination?: string; events?: LineInboundEvent[] };
  const list = Array.isArray(body.events) ? body.events : [];
  const events: GatewayEvent[] = [];
  let skipped = 0;

  list.forEach((raw, index) => {
    const eventType = typeof raw?.type === "string" ? raw.type : "unknown";
    const messageType = typeof raw?.message?.type === "string" ? raw.message.type : null;
    const capability = capabilityForInboundEvent(eventType, messageType);
    if (!capability) {
      skipped += 1;
      return;
    }

    events.push({
      event_id: newEventId(raw?.webhookEventId, index, raw?.timestamp),
      provider: "line",
      capability,
      channel: "observe",
      action: "observe",
      session_id: null,
      change_id: null,
      evidence: {
        webhook_event_id: raw?.webhookEventId ?? null,
        event_type: eventType,
        source_type: raw?.source?.type ?? null,
        // Identity as a VALUE for evidence/attribution — never as authority.
        sender_id: raw?.source?.userId ?? null,
        message_type: messageType,
        has_media: messageType === "image" || messageType === "file" || messageType === "audio" || messageType === "video",
        is_redelivery: raw?.deliveryContext?.isRedelivery === true,
        channel_destination: typeof body.destination === "string" ? body.destination : null,
        provider_timestamp: typeof raw?.timestamp === "number" ? raw.timestamp : null,
        project_id: (raw?.project_id as string | null) ?? null,
        document_group_id: (raw?.document_group_id as string | null) ?? null,
        customer_company_id: (raw?.customer_company_id as string | null) ?? null,
        customer_site_id: (raw?.customer_site_id as string | null) ?? null,
      },
      requested_effect: "none",
      requires_owner_approval: false,
      occurred_at: typeof raw?.timestamp === "number" ? new Date(raw.timestamp).toISOString() : new Date().toISOString(),
    });
  });

  return { events, skipped };
}
