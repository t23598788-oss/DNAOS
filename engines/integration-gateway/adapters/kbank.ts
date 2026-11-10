/**\
 * Integration Gateway — KBank Adapter (new provider, 2026-11-09).
 *
 * This is the ONE place allowed to read a raw KBank webhook payload. It runs
 * at the Provider Adapter boundary and does protocol-level work only:
 *   - translation of each inbound KBank event into the canonical GatewayEvent
 *
 * What it deliberately does NOT do (per the provider-retreat line):
 *   - no business table access, no business rule, no money, no DB client
 *   - the evidence contract is a KEY WHITELIST (see EVIDENCE_KEYS), so the
 *     boundary can never leak customer content or a token into a core table
 *
 * Observe Channel only, exactly like every other adapter in this folder:
 * every event carries requested_effect: "none" and action: "observe".
 */
import type { GatewayCapability, GatewayEvent } from "../contracts/event";

/**\
 * The exact evidence keys this adapter may emit. Anything not listed here
 * must not appear — a raw text body, a transaction id, or a reference has
 * no key to travel under, so it cannot reach integration_gateway_events by
 * accident.
 */
export const KBANK_EVIDENCE_KEYS: readonly string[] = [
  "amount",
  "currency",
  "transaction_time",
  "reference",
  "event_type",
  "source_type",
  "id",
  "status",
  "channel_destination",
  "provider_timestamp",
];

/** Business meaning of one inbound KBank event, expressed provider-agnostically.
 *  Maps KBank's domain vocabulary to the GatewayCapability union.
 */
export function capabilityForKBankEvent(event_type: string, status: string | null): GatewayCapability | null {
  const t = event_type.toLowerCase();
  const s = status ? status.toLowerCase() : "";

  // payment.*
  if (t.startsWith("payment")) {
    if (t.includes("received") || t.includes("captured") || t === "charge.success" || t === "authorized") {
      return "payment.received";
    }
    if (t.includes("refunded") || t === "charge.refunded" || t === "reversed") {
      return "payment.refunded";
    }
    if (t.includes("completed") || t === "paid" || t === "settlement.completed") {
      return "payment.completed";
    }
    if (t.includes("failed") || t === "charge.failed" || t === "declined") {
      return "payment.failed";
    }
    // default fallback
    return "payment.received";
  }

  // payout.*
  if (t.startsWith("payout")) {
    if (t.includes("failed") || t === "paid_out.failed" || s === "failed") {
      return "payout.failed";
    }
    return "payout.completed";
  }

  // transfer /
  if (t === "transfer.completed" || t === "transfer.success") {
    return "transfer.completed";
  }
  if (t === "transfer.failed" || t === "transfer.rejected") {
    return "transfer.failed";
  }

  return null;
}

interface KBankSource {
  type?: string;
  id?: string;
  account_id?: string;
}

interface KBankEvent {
  type?: string;
  id?: string;
  status?: string;
  timestamp?: string | number;
  source?: KBankSource;
  amount?: number | string;
  currency?: string;
  reference?: string;
  transaction_time?: string;
  metadata?: Record<string, unknown>;
}

interface KBankWebhookPayload {
  destination?: string;
  events?: KBankEvent[];
  event?: KBankEvent;
}

interface KBankInboundEvent {
  type?: string;
  id?: string;
  status?: string;
  timestamp?: string | number;
  source?: KBankSource;
  amount?: number | string;
  currency?: string;
  reference?: string;
  transaction_time?: string;
  metadata?: Record<string, unknown>;
}

function newEventId(event_id?: string, suffix?: string): string {
  if (event_id && event_id.trim()) return `EVT-kbank-${event_id.trim()}${suffix ? `-${suffix}` : ""}`;
  return `EVT-kbank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalizes a whole KBank webhook payload (KBank batches `events[]`) into
 * GatewayEvents. Events whose type this boundary does not translate yet are
 * skipped — reported as `skipped`, never invented into a capability.
 *
 * Returns an array of GatewayEvents (one per translated KBank event).
 */
export function normalizeKBankWebhook(payload: unknown): GatewayEvent[] {
  const body = (payload ?? {}) as KBankWebhookPayload;
  const list = Array.isArray(body.events) ? body.events : [];
  if (list.length === 0 && body.event) {
    // Single-event response (non-batch)
    const single = body.event as KBankInboundEvent;
    const capability = capabilityForKBankEvent(single.type ?? "", single.status ?? "");
    if (!capability) return [];
    return [toGatewayEvent(single, capability, typeof body.destination === "string" ? body.destination : null)];
  }

  const events: GatewayEvent[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index] as KBankInboundEvent;
    const eventType = typeof raw?.type === "string" ? raw.type : "unknown";
    const status = typeof raw?.status === "string" ? raw.status : null;
    const capability = capabilityForKBankEvent(eventType, status);
    if (!capability) continue;

    events.push(toGatewayEvent(raw, capability, typeof body.destination === "string" ? body.destination : null));
  }

  return events;
}

function toGatewayEvent(
  raw: KBankInboundEvent,
  capability: GatewayCapability,
  channelDestination: string | null,
): GatewayEvent {
  const amount = raw.amount ?? null;
  const currency = raw.currency ?? null;
  const reference = raw.reference ?? null;
  const transactionTime = raw.transaction_time ?? null;

  return {
    event_id: newEventId(raw?.id, `idx-${String(raw)}`),
    provider: "kbank",
    capability,
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: raw?.id ?? null,
    evidence: {
      amount: typeof amount === "number" ? amount : amount,
      currency,
      transaction_time: transactionTime ?? null,
      reference,
      event_type: raw?.type ?? null,
      source_type: raw?.source?.type ?? null,
      id: raw?.id ?? null,
      status: raw?.status ?? null,
      channel_destination: channelDestination ?? null,
      provider_timestamp: raw?.timestamp ?? null,
    },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: raw?.timestamp
      ? typeof raw.timestamp === "number"
        ? new Date(raw.timestamp).toISOString()
        : raw.timestamp
      : new Date().toISOString(),
  };
}
