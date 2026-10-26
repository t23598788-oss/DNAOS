/**
 * Webhook Gate — the single place that decides whether an inbound webhook is
 * allowed to become a stored event.
 *
 * Why this module exists (owner security audit, 2026-10-26): the route used to
 * verify a signature only when `config.signature_header` happened to be set,
 * so a connector without that field accepted ANY body — unauthenticated — and
 * answered 200. Guard order is now fixed and fail-closed:
 *
 *   connector enabled → body size → signature configuration → signature itself
 *
 * Every branch is denial-by-default: an absent configuration is a rejection
 * (503), not a bypass. Kept dependency-free (node:crypto only) so the rules can
 * be unit-tested without Next, Supabase or a running server.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto"
import { normalizeSignatureHeader } from "@/core/webhook-signature"

export { requireSignatureHeader } from "@/core/webhook-signature"

/** Hard ceiling for an inbound webhook body. Anything larger is rejected. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

/** Headers that may be persisted with the event. Everything else is dropped. */
const BASE_STORED_HEADERS = ["content-type", "content-length", "user-agent"] as const

export type WebhookRejectReason =
  | "connector_not_found"
  | "connector_not_webhook"
  | "connector_not_enabled"
  | "body_too_large"
  | "signature_not_configured"
  | "signature_missing"
  | "signature_invalid"

export interface WebhookGateConnector {
  id: string
  auth_type?: string | null
  status?: string | null
  enabled?: boolean | null
  config?: Record<string, unknown> | null
  secret?: Record<string, unknown> | null
}

export interface WebhookGateInput {
  connector: WebhookGateConnector | null | undefined
  /** Raw request body, exactly as received (signature covers bytes, not JSON). */
  rawBody: string
  /** All request headers, lower-cased keys. */
  headers: Record<string, string>
  /** `content-length` header if the client sent one (pre-read guard). */
  contentLength?: string | null
}

export type WebhookGateResult =
  | {
      ok: true
      verified: true
      eventKey: string
      payload: unknown
      storedHeaders: Record<string, string>
    }
  | {
      ok: false
      status: 404 | 401 | 413 | 503
      reason: WebhookRejectReason
      error: string
    }

function reject(status: 404 | 401 | 413 | 503, reason: WebhookRejectReason, error: string): WebhookGateResult {
  return { ok: false, status, reason, error }
}

/** HMAC-SHA256 hex comparison, tolerant of the `sha256=` prefix and of junk input. */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  const provided = signature.trim().replace(/^sha256=/i, "")
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(provided, "utf8")
  if (a.length !== b.length || b.length === 0) return false
  return timingSafeEqual(a, b)
}

/** Dot-path lookup used by `config.event_id_path` (e.g. "event.id" or "data.transactionId"). */
export function readPath(payload: unknown, path: string): string | null {
  if (!path) return null
  let cursor: unknown = payload
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return null
    cursor = (cursor as Record<string, unknown>)[key]
  }
  if (typeof cursor === "string" && cursor.trim()) return cursor.trim()
  if (typeof cursor === "number" && Number.isFinite(cursor)) return String(cursor)
  return null
}

/**
 * Idempotency key for one event. The provider's own event id wins when the
 * connector declares where it lives; otherwise the signature-verified body hash
 * is used, so a byte-identical redelivery can never be stored twice.
 */
export function deriveEventKey(payload: unknown, rawBody: string, eventIdPath: unknown): string {
  const declared = typeof eventIdPath === "string" ? readPath(payload, eventIdPath) : null
  if (declared) return `id:${declared}`
  return `sha256:${createHash("sha256").update(rawBody).digest("hex")}`
}

function pickStoredHeaders(headers: Record<string, string>, signatureHeader: string): Record<string, string> {
  const allowed = new Set<string>([...BASE_STORED_HEADERS, signatureHeader.toLowerCase()])
  const stored: Record<string, string> = {}
  for (const name of allowed) {
    const value = headers[name]
    if (typeof value === "string") stored[name] = value
  }
  return stored
}

export function evaluateWebhookRequest(input: WebhookGateInput): WebhookGateResult {
  const { connector, rawBody, headers, contentLength } = input

  // 1. The connector must exist AND be a webhook connector.
  if (!connector) return reject(404, "connector_not_found", "ไม่พบ Webhook Connector นี้")
  if (connector.auth_type !== "webhook") return reject(404, "connector_not_webhook", "ไม่พบ Webhook Connector นี้")

  // 2. A connector that is not connected+enabled must not ingest anything.
  //    (Route also resolves through getConnectedConnector; this is the second lock.)
  if (connector.enabled !== true || connector.status !== "connected") {
    return reject(404, "connector_not_enabled", "ไม่พบ Webhook Connector นี้")
  }

  // 3. Size guard, before parsing anything.
  const declaredLength = Number(contentLength ?? "")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return reject(413, "body_too_large", "เนื้อหาคำขอใหญ่เกินกำหนด")
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return reject(413, "body_too_large", "เนื้อหาคำขอใหญ่เกินกำหนด")
  }

  // 4. Fail CLOSED when signature verification is not configured.
  const config = (connector.config ?? {}) as Record<string, unknown>
  const secret = (connector.secret ?? {}) as Record<string, unknown>
  const signatureHeader = normalizeSignatureHeader(config.signature_header)
  const signingSecret = typeof secret.signing_secret === "string" ? secret.signing_secret : ""
  if (!signatureHeader || !signingSecret) {
    return reject(
      503,
      "signature_not_configured",
      "Webhook นี้ยังไม่ได้ตั้งค่าลายเซ็น — ปฏิเสธคำขอไว้ก่อน (fail-closed)"
    )
  }

  // 5. Signature itself.
  const signature = headers[signatureHeader]
  if (!signature) return reject(401, "signature_missing", "ลายเซ็นไม่ถูกต้อง")
  if (!verifySignature(rawBody, signature, signingSecret)) {
    return reject(401, "signature_invalid", "ลายเซ็นไม่ถูกต้อง")
  }

  // 6. Only a verified body is parsed and only allow-listed headers are stored.
  let payload: unknown = rawBody
  try {
    payload = JSON.parse(rawBody)
  } catch {
    /* non-JSON providers keep the raw text */
  }

  return {
    ok: true,
    verified: true,
    eventKey: deriveEventKey(payload, rawBody, config.event_id_path),
    payload,
    storedHeaders: pickStoredHeaders(headers, signatureHeader),
  }
}
