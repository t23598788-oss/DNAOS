import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { confirmReceiptPayment } from "@/engines/canonical/receipt-confirm-flow"
import { acknowledgePayment } from "@/gateway/payment-acknowledgement"

type Params = { params: Promise<{ id: string }> }

// Payment Verification Engine — Phase 1 (owner, 2026-07-18): the manual path
// a LINE-slip classification (receipt_documents, status "ai_read" = Pending
// Review under this table's pre-existing 3-state vocabulary) turns into a
// real receipt_received debt event. A human clicking this button IS the
// confirmation Rule 72 requires.
//
// UPDATED 2026-07-24 (owner decision, Autonomous Payment Confirmation): this
// is no longer the ONLY path — supabase/functions/line-webhook-v2/handlers/
// image.ts's tryAutoConfirmPayment() now does this same mutation
// automatically, but ONLY when the OCR evidence is already fully legible
// (amount + sender_name + transaction_datetime + a real matched company).
// This manual route remains the path for everything else: incomplete
// evidence, a customer_company_id that needed matching after the fact, or
// any slip that stayed Pending Review for a human to check.
//
// P4 (owner decision D2 = ก, 2026-09-24): the money sequence itself moved
// into engines/canonical/receipt-confirm-flow.ts — ONE implementation shared
// with the Connect payment bridge (confirmPayment + penalty split + receipt
// finalization 4 fields). This route keeps its own auth + eligibility checks
// and maps the outcome to the exact same responses it always returned.
export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const db = supabase()

  const { data: doc, error: docErr } = await db
    .from("receipt_documents")
    .select("id, document_type, status, amount, transaction_datetime, document_date, customer_company_id, sender_name, reference_number")
    .eq("id", id)
    .maybeSingle()
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })
  if (!doc) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
  // Real incident found 2026-07-24 (บจก. เคที คอนสตรัคชั่น, ฿5,000 slip):
  // ocr-classify.ts's own DOCUMENT_TYPE_PROFILE treats "payment_advice" as an
  // equally real incoming-payment type alongside "transfer_slip" — this
  // guard only accepted transfer_slip, so a real payment classified as
  // payment_advice could never be confirmed even once matched to a company.
  if (doc.document_type !== "transfer_slip" && doc.document_type !== "payment_advice") {
    return NextResponse.json({ error: "ยืนยันได้เฉพาะสลิปโอนเงินหรือ Payment Advice เท่านั้น" }, { status: 400 })
  }
  if (doc.status !== "ai_read") {
    return NextResponse.json({ error: `เอกสารนี้ถูกดำเนินการไปแล้ว (สถานะ: ${doc.status})` }, { status: 400 })
  }
  if (!doc.customer_company_id) {
    return NextResponse.json({ error: "ยังไม่จับคู่บริษัทลูกค้า — ไม่สามารถหักยอดหนี้ได้" }, { status: 400 })
  }
  if (!doc.amount || Number(doc.amount) <= 0) {
    return NextResponse.json({ error: "ไม่มีจำนวนเงินที่อ่านได้จากสลิป" }, { status: 400 })
  }

  // เงินทั้งก้อน + receipt finalization = โฟลว์กลาง (manual/bridge ใช้ร่วมกัน —
  // debt snapshot อ่านข้างใน · resolvePaymentDocumentLink · confirmPayment ·
  // penalty split · finalization 4 fields)
  const outcome = await confirmReceiptPayment({ receipt_document_id: id, actor: auth.email })

  if (outcome.already_reconciled) {
    return NextResponse.json(
      { error: `เอกสารนี้ถูกดำเนินการไปแล้ว (สถานะ: ${outcome.receipt_status ?? "confirmed"})` },
      { status: 400 },
    )
  }
  if (!outcome.ok) {
    const message = outcome.error ?? "ยืนยันการชำระไม่สำเร็จ"
    if (message === "RECEIPT_NOT_FOUND") return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
    if (message === "RECEIPT_WRONG_TYPE") {
      return NextResponse.json({ error: "ยืนยันได้เฉพาะสลิปโอนเงินหรือ Payment Advice เท่านั้น" }, { status: 400 })
    }
    if (message === "RECEIPT_NO_COMPANY") {
      return NextResponse.json({ error: "ยังไม่จับคู่บริษัทลูกค้า — ไม่สามารถหักยอดหนี้ได้" }, { status: 400 })
    }
    if (message === "RECEIPT_NO_AMOUNT") {
      return NextResponse.json({ error: "ไม่มีจำนวนเงินที่อ่านได้จากสลิป" }, { status: 400 })
    }
    if (message === "RECEIPT_NOT_ELIGIBLE") {
      return NextResponse.json(
        { error: `เอกสารนี้ถูกดำเนินการไปแล้ว (สถานะ: ${outcome.receipt_status ?? "unknown"})` },
        { status: 400 },
      )
    }
    const isPaymentClass = message.startsWith("PAYMENT_") || message === "DEBT_SNAPSHOT_NOT_FOUND"
    return NextResponse.json({ error: message }, { status: isPaymentClass ? 409 : 500 })
  }

  // ── payment acknowledgement (BATCH 40) — NON-FATAL side channel ────────────
  // select-or-create receipt doc + ledger summary + LINE push + delivery
  // evidence. A failed ack must never fail (or roll back) a confirmed payment:
  // it is reported in the response so the caller can retry via
  // POST .../acknowledge.
  let acknowledgement: Awaited<ReturnType<typeof acknowledgePayment>> | null = null
  try {
    acknowledgement = await acknowledgePayment({ receipt_document_id: id, actor: auth.email ?? auth.id })
  } catch (e) {
    acknowledgement = { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "ack failed" }
  }

  return NextResponse.json({
    ok: true,
    debt_event_id: outcome.debt_event_id,
    amount_deducted: Number(doc.amount),
    payment_kind: outcome.payment_kind,
    document: outcome.document,
    canonical: outcome.canonical,
    acknowledgement,
  })
}
