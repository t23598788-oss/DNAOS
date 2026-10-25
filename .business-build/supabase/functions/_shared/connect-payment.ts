// Connect payment-confirmation transport (LINE financial-edge removal P4 ·
// owner decision D2 = ก, 2026-09-24) — the provider tier's ONLY path to
// confirm a received payment.
//
// มันรู้จักคำสั่งเดียว { receipt_document_id, actor } และไม่รู้จักอะไรอีก:
// ไม่มีสูตรเงิน · ไม่มีคอลัมน์ตาราง · ไม่มีการ insert business table ตรง ๆ ·
// ไม่มี fallback จงใจ — missing app URL/secret, non-2xx, หรือ flow ปฏิเสธ
// ทั้งหมดคืน { ok: false } ให้ caller เดิมจัดการ error ต่อ (ปล่อย slip ค้าง
// Pending Review เหมือน legacy rpc error path ทุกประการ)
//
// env ที่ต้องมี (คู่กัน two-sided — ขาดฝั่งใดฝั่งหนึ่ง = fail closed):
//   Deno:    DNA_OS_APP_URL + PAYMENT_CONFIRM_INTERNAL_SECRET (supabase secrets)
//   Next:    PAYMENT_CONFIRM_INTERNAL_SECRET (.env / Vercel — เอกสาร: .env.local.example)
export interface ConnectPaymentConfirmResult {
  ok: boolean
  error?: string
  data?: {
    already_reconciled: boolean
    new_outstanding: number | null
    debt_event_id: string | null
  }
}

export async function sendConnectPaymentConfirm(
  receiptDocumentId: string,
  actor: string,
): Promise<ConnectPaymentConfirmResult> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const secret = Deno.env.get("PAYMENT_CONFIRM_INTERNAL_SECRET")
  if (!appUrl || !secret) {
    return { ok: false, error: "PAYMENT_CONNECT_TRANSPORT_NOT_CONFIGURED" }
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/payment-confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment-confirm-internal-secret": secret },
      body: JSON.stringify({ receipt_document_id: receiptDocumentId, actor }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => ({}))) as ConnectPaymentConfirmResult
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `PAYMENT_CONNECT_TRANSPORT_HTTP_${res.status}` }
    }
    return { ok: true, data: body.data }
  } catch (err) {
    return { ok: false, error: `PAYMENT_CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` }
  }
}
