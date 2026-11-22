/** Kod Chat Bot API v1 adapter. Provider contract verified against
 * https://kobchat.com/docs/bot-api (checked 2026-11-15). */
import { createHmac, timingSafeEqual } from "crypto";
import type { GatewayEvent } from "../contracts/event";
import type { CoreEventEnvelope } from "../../../supabase/functions/_shared/core-event";

export type KodChatErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "INVALID_PAYLOAD"
  | "CREDENTIAL_MISSING"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED";

export interface KodChatAdapterResponse<T = unknown> {
  status: "success" | "error";
  data?: T;
  error_code?: KodChatErrorCode;
}

export interface KodChatWebhookConfig {
  signatureHeader?: string;
  signatureEncoding?: "hex" | "base64";
  signaturePrefix?: string;
}

export interface KodChatSendConfig {
  apiBaseUrl: string;
  sendMessagePath: string;
}

export interface KodChatCredentials {
  apiKey?: string;
  webhookSecret?: string;
}

export interface KodChatWebhookRegistrationConfig {
  apiBaseUrl?: string;
}

export type KodChatRecipient = { userId: string } | { roomId: string };

const KODCHAT_API_BASE_URL = "https://kobchat.com/api/bot/v1";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_SKEW_MS = 5 * 60 * 1000;

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Kod Chat's X-Kob-Signature is base64(HMAC-SHA256(secret, rawBody));
 * the signature is over the exact raw request bytes and has no prefix. */
export function verifyKodChatWebhookSignature(
  rawBody: string,
  signatureHeaderValue: string | null,
  secret: string,
  config: KodChatWebhookConfig = {},
): boolean {
  if (!signatureHeaderValue || !secret) return false;
  const digest = createHmac("sha256", secret)
    .update(rawBody)
    .digest(config.signatureEncoding ?? "base64");
  const prefix = config.signaturePrefix ?? "";
  const supplied = signatureHeaderValue.startsWith(prefix)
    ? signatureHeaderValue.slice(prefix.length)
    : signatureHeaderValue;
  return constantTimeEqual(supplied, digest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max = 512): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function providerTimestamp(value: unknown): { iso: string; fresh: boolean } {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const parsed = Number.isFinite(numeric)
    ? numeric
    : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return { iso: new Date().toISOString(), fresh: false };
  const date = new Date(parsed);
  return {
    iso: date.toISOString(),
    fresh: Math.abs(Date.now() - parsed) <= MAX_EVENT_SKEW_MS,
  };
}

function eventCapability(event: Record<string, unknown>): GatewayEvent["capability"] | null {
  if (event.type === "postback") return "interaction.received";
  if (event.type !== "message" || !isRecord(event.message)) return null;
  switch (event.message.type) {
    case "text": return "message.received";
    case "image":
    case "video":
    case "file":
    case "audio": return "document.received";
    case "location": return "location.received";
    case "sticker": return "interaction.received";
    default: return null;
  }
}

/** Normalize Kod Chat's native {destination, events[]} webhook shape.
 * Message text, postback data, usernames, file names and URLs are deliberately
 * omitted from evidence; those values are untrusted user input. */
export function normalizeKodChatWebhook(value: unknown): { events: GatewayEvent[]; skipped: number } {
  if (!isRecord(value) || !Array.isArray(value.events)) return { events: [], skipped: 1 };
  const normalized: GatewayEvent[] = [];
  let skipped = 0;

  for (const rawEvent of value.events) {
    if (!isRecord(rawEvent)) { skipped++; continue; }
    const capability = eventCapability(rawEvent);
    const source = isRecord(rawEvent.source) ? rawEvent.source : null;
    const eventId = boundedString(rawEvent.webhookEventId, 256);
    const roomId = boundedString(source?.roomId);
    const userId = boundedString(source?.userId);
    const timestamp = providerTimestamp(rawEvent.timestamp);
    if (!capability || !eventId || !roomId || !timestamp.fresh) { skipped++; continue; }

    const message = isRecord(rawEvent.message) ? rawEvent.message : null;
    const messageId = boundedString(message?.id, 256);
    const messageType = boundedString(message?.type, 80) ?? (rawEvent.type === "postback" ? "postback" : "unknown");
    const hasMedia = ["image", "video", "file", "audio"].includes(messageType);
    normalized.push({
      event_id: `EVT-kodchat-${eventId}`,
      provider: "kodchat",
      capability,
      channel: "observe",
      action: "observe",
      session_id: roomId,
      change_id: messageId ?? eventId,
      evidence: {
        webhook_event_id: eventId,
        event_type: boundedString(rawEvent.type, 80),
        sender_id: userId,
        conversation_id: roomId,
        message_type: messageType,
        has_media: hasMedia,
        provider_timestamp: timestamp.iso,
      },
      requested_effect: "none",
      requires_owner_approval: false,
      occurred_at: timestamp.iso,
    });
  }

  return { events: normalized, skipped };
}

/** Build transient Core queue messages only for text turns that are eligible
 * for the registered conversation.answer AI capability. Raw text is not put
 * into GatewayEvent evidence or the durable integration event table. */
export function kodChatCoreEvents(value: unknown): CoreEventEnvelope[] {
  if (!isRecord(value) || !Array.isArray(value.events)) return [];
  const output: CoreEventEnvelope[] = [];
  for (const rawEvent of value.events) {
    if (!isRecord(rawEvent) || rawEvent.type !== "message" || !isRecord(rawEvent.message) || rawEvent.message.type !== "text") continue;
    const source = isRecord(rawEvent.source) ? rawEvent.source : null;
    const externalSubjectId = boundedString(source?.userId);
    const conversationId = boundedString(source?.roomId);
    const eventId = boundedString(rawEvent.webhookEventId, 256);
    const text = typeof rawEvent.message.text === "string" ? rawEvent.message.text.trim() : "";
    const timestamp = providerTimestamp(rawEvent.timestamp);
    if (!externalSubjectId || !conversationId || !eventId || !timestamp.fresh || !text || text.length > 12_000) continue;
    const now = new Date().toISOString();
    output.push({
      event_id: `core-kodchat-${eventId}`,
      idempotency_key: `kodchat:${eventId}`,
      schema_version: "1.0.0",
      event_type: "message.received",
      source: "kodchat",
      source_event_id: eventId,
      tenant_id: null,
      actor: { type: "user", id: externalSubjectId },
      correlation: { parent_event_id: eventId },
      occurred_at: timestamp.iso,
      recorded_at: now,
      data: {
        capability_id: "conversation.answer",
        sender_id: externalSubjectId,
        conversation_id: conversationId,
        message_text: text,
      },
    });
  }
  return output;
}

/** Send a native Kod Chat Bot API v1 message. Exactly one target field is
 * accepted: userId for a direct message, or roomId for a group/chat room. */
export async function sendMessage(
  recipient: KodChatRecipient,
  text: string,
  credentials: KodChatCredentials,
  config: KodChatSendConfig = { apiBaseUrl: KODCHAT_API_BASE_URL, sendMessagePath: "/messages" },
  fetchImpl: typeof fetch = fetch,
): Promise<KodChatAdapterResponse<{ provider_status: number; request_id: string | null }>> {
  const recipientRecord = recipient as Record<string, unknown> | null;
  const targetKeys = recipientRecord ? ["userId", "roomId"].filter((key) => typeof recipientRecord[key] === "string" && Boolean(recipientRecord[key])) : [];
  const targetId = recipientRecord && targetKeys.length === 1 ? recipientRecord[targetKeys[0]] as string : "";
  const trimmedText = text.trim();
  if (targetKeys.length !== 1 || targetId.length > 512 || !trimmedText || trimmedText.length > MAX_MESSAGE_LENGTH) {
    return { status: "error", error_code: "INVALID_PAYLOAD" };
  }
  if (!credentials.apiKey) return { status: "error", error_code: "CREDENTIAL_MISSING" };
  if (!config.apiBaseUrl || !config.sendMessagePath) return { status: "error", error_code: "INVALID_PAYLOAD" };

  let endpoint: URL;
  try {
    const base = new URL(config.apiBaseUrl);
    if (base.protocol !== "https:" || base.username || base.password) return { status: "error", error_code: "INVALID_PAYLOAD" };
    endpoint = new URL(config.sendMessagePath.replace(/^\/+/, ""), `${base.toString().replace(/\/+$/, "")}/`);
    if (endpoint.origin !== base.origin) return { status: "error", error_code: "INVALID_PAYLOAD" };
  } catch {
    return { status: "error", error_code: "INVALID_PAYLOAD" };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({ ...recipient, text: trimmedText }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { status: "error", error_code: "PROVIDER_UNAVAILABLE" };
  }

  if (response.status === 401 || response.status === 403) return { status: "error", error_code: "AUTH_FAILED" };
  if (response.status === 429) return { status: "error", error_code: "RATE_LIMITED" };
  if (response.status >= 500) return { status: "error", error_code: "PROVIDER_UNAVAILABLE" };
  if (!response.ok) return { status: "error", error_code: "PROVIDER_REJECTED" };
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: "success", data: { provider_status: response.status, request_id: null } };
  }

  let requestId: string | null = null;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const message = isRecord(body.message) ? body.message : null;
      const rawId = message?.id ?? body.request_id ?? body.message_id ?? body.id;
      requestId = typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : boundedString(rawId, 256);
    }
  } catch {
    // A successful empty/non-JSON response is acceptable; it carries no evidence id.
  }
  return { status: "success", data: { provider_status: response.status, request_id: requestId } };
}

/** Register/replace the callback using Kob Chat's PUT /webhook API. The
 * callback and secret are provided by the trusted server-side caller only. */
export async function registerKobChatWebhook(
  callbackUrl: string,
  credentials: KodChatCredentials,
  config: KodChatWebhookRegistrationConfig = {},
  fetchImpl: typeof fetch = fetch,
): Promise<KodChatAdapterResponse<{ provider_status: number }>> {
  if (!credentials.apiKey || !credentials.webhookSecret) {
    return { status: "error", error_code: "CREDENTIAL_MISSING" };
  }
  if (!/^[\x21-\x7E]{16,200}$/.test(credentials.webhookSecret)) {
    return { status: "error", error_code: "INVALID_PAYLOAD" };
  }

  let endpoint: URL;
  let callback: URL;
  try {
    const base = new URL(config.apiBaseUrl ?? KODCHAT_API_BASE_URL);
    callback = new URL(callbackUrl);
    if (base.protocol !== "https:" || base.hostname !== "kobchat.com" || callback.protocol !== "https:" || callback.username || callback.password) {
      return { status: "error", error_code: "INVALID_PAYLOAD" };
    }
    endpoint = new URL("webhook", `${base.toString().replace(/\/+$/, "")}/`);
    if (endpoint.origin !== base.origin) return { status: "error", error_code: "INVALID_PAYLOAD" };
  } catch {
    return { status: "error", error_code: "INVALID_PAYLOAD" };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({ url: callback.toString(), secret: credentials.webhookSecret }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return { status: "error", error_code: "AUTH_FAILED" };
    if (response.status === 429) return { status: "error", error_code: "RATE_LIMITED" };
    if (response.status >= 500) return { status: "error", error_code: "PROVIDER_UNAVAILABLE" };
    if (!response.ok) return { status: "error", error_code: "PROVIDER_REJECTED" };
    return { status: "success", data: { provider_status: response.status } };
  } catch {
    return { status: "error", error_code: "PROVIDER_UNAVAILABLE" };
  }
}
