/**
 * Webhook signature header — shared rule for the two sides of the gateway:
 * `createConnector` (must refuse a webhook connector with no header name) and
 * `app/api/connectors/webhook/[slug]/_lib/webhookGate.ts` (must reject when it
 * is missing). Kept dependency-free so both layers can import it, and so the
 * rule can be unit-tested without Next or Supabase.
 */

export function normalizeSignatureHeader(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

/**
 * Fail-closed at the source: a webhook connector without a signature header
 * name could never be verified, so creating one must be an error rather than a
 * silent fail-open row.
 */
export function requireSignatureHeader(value: unknown): string {
  const header = normalizeSignatureHeader(value)
  if (!header) {
    throw new Error(
      "SIGNATURE_HEADER_REQUIRED — webhook connector ต้องระบุ signature_header (ชื่อ header ที่ผู้ส่งใช้แนบลายเซ็น)"
    )
  }
  return header
}
