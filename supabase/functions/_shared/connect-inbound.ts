// Connect inbound-source transport (LINE financial-edge removal P4b ·
// owner approval 2026-09-24) — the provider tier's only path to CREATE a
// receipt_documents row (payment claim / OCR slip).
//
// มันรู้จัก field ของ inbound record เท่านั้น (evidence ที่ caller อ่านได้
// จริง) และไม่รู้จัก: คอลัมน์ตาราง · การ insert business table ตรง ๆ ·
// เงิน · fallback — missing env/secret, non-2xx หรือ writer ปฏิเสธ ทั้งหมด
// คืน { ok: false } ให้ caller จัดการเอง fail-closed เหมือน connect-event
//
// env ที่ต้องมี (two-sided — ขาดฝั่งใด = fail closed):
//   Deno: DNA_OS_APP_URL + INBOUND_SOURCE_INTERNAL_SECRET (supabase secrets)
//   Next: INBOUND_SOURCE_INTERNAL_SECRET (.env.local.example มีเอกสาร)
//
// type ข้างล่างเป็น mirror ของ engines/canonical/inbound-write.ts — Deno
// ฝั่งนี้ import จาก Node engine ไม่ได้ (แบบ connect-event ที่ define
// types ของตัวเอง) — canonical ที่ validate จริงอยู่ฝั่ง Next เสมอ

type InboundChannel = "line" | "upload" | "email" | "bank" | "drive"
type InboundReceiptStatus = "ai_read" | "waiting_bank_confirmation"

export interface ConnectInboundPayload {
  channel: InboundChannel
  media_path: string | null
  document_type: string
  line_event_id?: string | null
  customer_company_id?: string | null
  raw_ocr_text?: string | null
  amount?: number | null
  sender_name?: string | null
  sender_bank?: string | null
  reference_number?: string | null
  transaction_datetime?: string | null
  document_date?: string | null
  vendor_name?: string | null
  description?: string | null
  confidence?: number | null
  verification_level?: number | null
  error_th?: string | null
  status?: InboundReceiptStatus
  provenance?: Record<string, unknown> | null
}

export interface ConnectInboundResult {
  ok: boolean
  error?: string
  data?: { receipt_document_id: string; status: string; unlinked: boolean; media_verified: boolean }
}

export async function sendConnectInboundSource(
  payload: ConnectInboundPayload,
  actor: string,
): Promise<ConnectInboundResult> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const secret = Deno.env.get("INBOUND_SOURCE_INTERNAL_SECRET")
  if (!appUrl || !secret) {
    return { ok: false, error: "INBOUND_CONNECT_TRANSPORT_NOT_CONFIGURED" }
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/inbound-source`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-inbound-source-internal-secret": secret },
      body: JSON.stringify({ ...payload, actor }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => ({}))) as ConnectInboundResult
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `INBOUND_CONNECT_TRANSPORT_HTTP_${res.status}` }
    }
    return { ok: true, data: body.data }
  } catch (err) {
    return { ok: false, error: `INBOUND_CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` }
  }
}
