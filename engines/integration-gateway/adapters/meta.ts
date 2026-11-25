// Integration Gateway — Meta adapter (Facebook Messenger + Instagram messaging receive, owner channel-expansion 2026-10-07).
//
// ONE adapter for BOTH surfaces because Meta delivers both through the SAME
// webhook contract (verified against Meta docs 2026-10-07):
//   - signature: X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256(rawBody, appSecret)
//   - GET verification: hub.mode=subscribe + hub.verify_token match -> echo hub.challenge
//   - payload: object "page" (Messenger) / "instagram" (Instagram Messaging),
//     entry[].messaging[].{sender, recipient, timestamp, message:{mid,text?,attachments?}}
// The ONLY code allowed to read a raw Meta webhook payload — protocol work only:
// signature verification + translation into canonical GatewayEvents. Exactly the
// same discipline as adapters/line.ts:
//   - no business table access, no DB client, no money, no reply
//   - EVIDENCE_KEYS is a KEY WHITELIST: sender/conversation/message ids and
//     real file facts (attachment types, has_media) are kept for audit — raw
//     message text and attachment URLs never enter the evidence payload
//   - messages sent BY the business (is_echo) are SKIPPED — inbound only
//   - unsupported event shapes are skipped and counted, never invented
// Observe Channel only: every event carries requested_effect "none".
import { createHmac, timingSafeEqual } from "crypto";
import type { GatewayCapability, GatewayEvent, GatewayProvider } from "../contracts/event";

/**
 * Meta signature scheme (X-Hub-Signature-256): "sha256=" + hex HMAC-SHA256 of
 * the raw body with the app secret. timing-safe compare; empty secret/header
 * fail-closed exactly like verifyLineSignature.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Meta GET webhook verification: hub.mode must be "subscribe" and hub.verify_token
 * must match the token configured in the App Dashboard — return the hub.challenge
 * to echo back (null = reject). Never throws; never guesses.
 */
export function metaVerifyChallenge(params: { mode?: string | null; verifyToken?: string | null; challenge?: string | null }, expectedToken: string): string | null {
  if (!expectedToken) return null;
  if (params.mode !== "subscribe") return null;
  if (!params.verifyToken || params.verifyToken !== expectedToken) return null;
  if (!params.challenge) return null;
  return params.challenge;
}

/**
 * The exact evidence keys this adapter may emit. sender/conversation/message ids
 * and timestamp are the audit facts the owner requires (provider, connector
 * account, sender, conversation, event id, source time, file evidence) — the raw
 * message TEXT and attachment URL are deliberately NOT listable here so they
 * cannot reach integration_gateway_events by accident (same whitelist rule as
 * adapters/line.ts EVIDENCE_KEYS).
 */
export const EVIDENCE_KEYS: readonly string[] = [
  "webhook_event_id",
  "event_type",
  "object_type",
  "entry_id",
  "sender_id",
  "recipient_id",
  "conversation_id",
  "message_type",
  "attachment_types",
  "has_media",
  "provider_timestamp",
];

interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: { type?: string; payload?: { url?: string } }[];
    is_echo?: boolean;
  };
  postback?: { mid?: string };
}

interface MetaPayload {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: MetaMessagingEvent[] }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Decode Meta's untrusted JSON shape before treating it as a typed event. */
function decodeMessagingEvent(value: unknown): MetaMessagingEvent | null {
  if (!isRecord(value)) return null;

  const sender = isRecord(value.sender) ? { id: optionalString(value.sender.id) } : undefined;
  const recipient = isRecord(value.recipient) ? { id: optionalString(value.recipient.id) } : undefined;
  const messageValue = isRecord(value.message) ? value.message : null;
  const attachments = messageValue && Array.isArray(messageValue.attachments)
    ? messageValue.attachments
      .filter(isRecord)
      .map((attachment) => ({
        type: optionalString(attachment.type),
        payload: isRecord(attachment.payload)
          ? { url: optionalString(attachment.payload.url) }
          : undefined,
      }))
    : undefined;
  const message = messageValue
    ? {
        mid: optionalString(messageValue.mid),
        text: optionalString(messageValue.text),
        is_echo: typeof messageValue.is_echo === "boolean" ? messageValue.is_echo : undefined,
        attachments,
      }
    : undefined;
  const postback = isRecord(value.postback)
    ? { mid: optionalString(value.postback.mid) }
    : undefined;

  return {
    sender,
    recipient,
    timestamp: typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
      ? value.timestamp
      : undefined,
    message,
    postback,
  };
}


/** Business meaning of one inbound Meta message, provider-agnostic — same verb set as the LINE adapter. */
export function capabilityForMetaMessage(hasMedia: boolean, messageType: string | null): GatewayCapability {
  const mediaTypes = ["image", "file", "audio", "video"];
  if (hasMedia && messageType && mediaTypes.includes(messageType)) return "document.received";
  return "message.received";
}

/** Postback maps to interaction.received; read/delivery/referral receipts carry no business meaning — skipped. */
function capabilityForMessagingEvent(ev: MetaMessagingEvent): GatewayCapability | null {
  if (ev.message) return capabilityForMetaMessage(
    Array.isArray(ev.message.attachments) && ev.message.attachments.length > 0,
    ev.message.attachments?.[0]?.type ?? (ev.message.text ? "text" : null),
  );
  if (ev.postback) return "interaction.received";
  return null;
}

function newEventId(provider: GatewayProvider, mid: string | undefined, timestamp: number | undefined, index: number): string {
  return `EVT-${provider}-${mid ?? `${timestamp ?? 0}-${index}`}`;
}

/**
 * Normalize a whole Meta webhook payload (page + instagram surfaces) into
 * GatewayEvents. Echoes (messages we sent), receipts and unknown object types
 * are SKIPPED and reported via `skipped`, never invented into a capability.
 * Deterministic event_id from the provider message id = redelivery is an
 * idempotent upsert in the evidence store (same dedup shape as EVT-line-*).
 */
export function normalizeMetaWebhook(payload: unknown): { events: GatewayEvent[]; skipped: number } {
  const body: MetaPayload = isRecord(payload)
    ? {
        object: optionalString(payload.object),
        entry: Array.isArray(payload.entry)
          ? payload.entry.filter(isRecord).map((entry) => ({
              id: optionalString(entry.id),
              time: typeof entry.time === "number" && Number.isFinite(entry.time) ? entry.time : undefined,
              messaging: Array.isArray(entry.messaging)
                ? entry.messaging.map(decodeMessagingEvent).filter((event): event is MetaMessagingEvent => event !== null)
                : undefined,
            }))
          : undefined,
      }
    : {};
  const objectType = typeof body.object === "string" ? body.object : "";
  // provider per surface: Messenger = object "page", Instagram Messaging = object "instagram".
  // Any other object (user, permissions, ...) is not a message surface — skip honestly.
  const provider: GatewayProvider | null = objectType === "page" ? "facebook" : objectType === "instagram" ? "instagram" : null;
  if (!provider) return { events: [], skipped: 1 };

  const events: GatewayEvent[] = [];
  let skipped = !isRecord(payload)
    ? 1
    : Array.isArray(payload.entry)
      ? payload.entry.reduce((count, entry) => {
          if (!isRecord(entry)) return count + 1;
          if (!Array.isArray(entry.messaging)) return count;
          return count + entry.messaging.filter((event) => !isRecord(event)).length;
        }, 0)
      : 0;
  const entries = Array.isArray(body.entry) ? body.entry : [];
  entries.forEach((entry, entryIndex) => {
    const list = Array.isArray(entry.messaging) ? entry.messaging : [];
    list.forEach((raw, index) => {
      // inbound only — an echo (is_echo) is OUR OWN outbound message coming back; not a receive
      if (raw.message?.is_echo === true) { skipped += 1; return; }
      const capability = capabilityForMessagingEvent(raw);
      if (!capability) { skipped += 1; return; }
      const mid = raw.message?.mid ?? raw.postback?.mid;
      const timestamp = raw.timestamp ?? entry.time;
      const attachmentTypes = (raw.message?.attachments ?? []).map((a) => a.type ?? "unknown");
      const senderId = raw.sender?.id ?? null;
      const recipientId = raw.recipient?.id ?? null;
      events.push({
        event_id: newEventId(provider, mid, timestamp, entryIndex * 1000 + index),
        provider,
        capability,
        channel: "observe",
        action: "observe",
        session_id: null,
        change_id: null,
        evidence: {
          webhook_event_id: mid ?? null,
          event_type: raw.message ? "message" : raw.postback ? "postback" : "unknown",
          object_type: objectType,
          entry_id: entry.id ?? null,
          sender_id: senderId,
          recipient_id: recipientId,
          // Meta page threads are 1:1 — the sender-scoped id IS the conversation key (payload has no group id)
          conversation_id: senderId,
          message_type: attachmentTypes[0] ?? (raw.message?.text ? "text" : null),
          attachment_types: attachmentTypes,
          has_media: attachmentTypes.length > 0,
          provider_timestamp: typeof timestamp === "number" ? timestamp : null,
        },
        requested_effect: "none",
        requires_owner_approval: false,
        occurred_at: typeof timestamp === "number" ? new Date(timestamp).toISOString() : new Date().toISOString(),
      });
    });
  });

  return { events, skipped };
}
