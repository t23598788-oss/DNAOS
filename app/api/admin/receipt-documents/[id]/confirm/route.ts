import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolvePaymentDocumentLink } from "@/engines/transactions/document-link"

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

  const occurredAt = (doc.transaction_datetime ?? doc.document_date ?? new Date().toISOString()).slice(0, 10)
  const amount = Number(doc.amount)

  // Debt Tracking Model is the Single Source of Truth (owner, 2026-07-17/18)
  // — read outstanding BEFORE mutating it, so resolvePaymentDocumentLink()
  // (engines/transactions/document-link.ts) classifies full vs. partial
  // against the real pre-payment balance, same function the preview list
  // (../route.ts GET) already used to show this slip's preview on the UI —
  // one classification, not two guesses.
  const { data: snapshot } = await db
    .from("debt_snapshots")
    .select("total_outstanding")
    .eq("customer_company_id", doc.customer_company_id)
    .maybeSingle()
  const outstandingBefore = Number(snapshot?.total_outstanding ?? 0)

  const { data: company } = await db
    .from("companies").select("name").eq("id", doc.customer_company_id).maybeSingle()

  const link = resolvePaymentDocumentLink({
    amount,
    transactionOutstanding: outstandingBefore,
    transactionId: doc.customer_company_id,
    partnerName: company?.name ?? undefined,
    reference: doc.reference_number ?? undefined,
  })

  // Real gap found live 2026-08-03: debt_snapshots.total_outstanding only
  // ever tracks principal (verified against a real debt-reminder card that
  // showed "เงินต้น 31,424.66" matching this field exactly). A payment that
  // covers the interest/penalty shown on that same reminder card was
  // recorded as one lump receipt_received for the FULL amount, then
  // total_outstanding was clamped at 0 — the interest/penalty portion
  // vanished from any structured record (still a real bank deposit, just no
  // longer traceable as interest income vs. principal collected). Split
  // into two typed events instead: principal against what was actually
  // owed, and a separate interest_penalty_received event for whatever the
  // payment covered beyond that — same total money, now honestly
  // attributed.
  const principalPortion = Math.min(amount, outstandingBefore)
  const interestPenaltyPortion = Math.round((amount - principalPortion) * 100) / 100

  const { data: event, error: eventErr } = await db
    .from("debt_events")
    .insert({
      customer_company_id: doc.customer_company_id,
      event_type: "receipt_received",
      amount: principalPortion,
      occurred_at: occurredAt,
      note: link.document.note,
      source: "line_chat",
      created_by: auth.email,
    })
    .select("id")
    .single()
  if (eventErr) return NextResponse.json({ error: eventErr.message }, { status: 500 })

  if (interestPenaltyPortion > 0) {
    const { error: interestErr } = await db.from("debt_events").insert({
      customer_company_id: doc.customer_company_id,
      event_type: "interest_penalty_received",
      amount: interestPenaltyPortion,
      occurred_at: occurredAt,
      note: `ดอกเบี้ย/ค่าปรับที่ได้รับพร้อมเงินต้น (สลิป ${doc.reference_number ?? id}, ยอดรวมที่โอนมาจริง ${amount.toLocaleString("th-TH")} บาท)`,
      source: "line_chat",
      created_by: auth.email,
    })
    if (interestErr) console.error("[receipt-documents/confirm] interest_penalty_received insert failed:", interestErr.message)
  }

  // Clamped at 0 rather than going negative; an overpayment beyond
  // principal + this transaction's real interest/penalty still isn't
  // handled (out of scope for this pass — flagged, not silently wrong).
  //
  // Real gap found live 2026-08-03 (คุณเท่ห์/เทย่า ขอนแก่น): reaching 0
  // outstanding here never closed collection_state — the debt-tracking
  // admin page kept showing "กำลังติดตาม" and a still-accruing daily
  // penalty (calcDebtTrackingSummary's penalty is flat-per-day, independent
  // of the remaining balance) for a debt that was already fully paid, until
  // someone noticed the mismatch and clicked "ปิดรายการ" by hand. Auto-close
  // whenever a payment actually brings the balance to 0, using the exact
  // same debt_closed event the manual button inserts (app/api/admin/
  // debt-trackings/[id]/events/route.ts) so this isn't a second parallel
  // close mechanism.
  if (snapshot) {
    const newOutstanding = Math.max(0, outstandingBefore - principalPortion)
    const snapshotUpdate: Record<string, unknown> = { total_outstanding: newOutstanding, updated_at: new Date().toISOString() }
    if (newOutstanding === 0) {
      snapshotUpdate.collection_state = "CLOSED"
      snapshotUpdate.overdue_amount = 0
      snapshotUpdate.days_overdue = 0
    }
    await db.from("debt_snapshots")
      .update(snapshotUpdate)
      .eq("customer_company_id", doc.customer_company_id)

    if (newOutstanding === 0) {
      await db.from("debt_events").insert({
        customer_company_id: doc.customer_company_id,
        event_type: "debt_closed",
        amount: null,
        occurred_at: occurredAt,
        note: `จ่ายครบแล้ว (สลิป ${doc.reference_number ?? id}) — ปิดรายการติดตามทวงหนี้อัตโนมัติ`,
        source: "line_chat",
        created_by: auth.email,
      })
    }
  }

  // Payment Verification Priority (owner, 2026-07-18) — payment_verified=true
  // only fires here, on a real human confirmation, standing in for the
  // unbuilt Level 3/4 sources (bank email/statement). Not automatic.
  await db.from("receipt_documents")
    .update({
      status: "confirmed",
      matched_debt_event_id: event.id,
      confirmed_by: auth.email,
      payment_verified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  return NextResponse.json({
    ok: true,
    debt_event_id: event.id,
    amount_deducted: amount,
    payment_kind: link.kind,
    document: link.document,
  })
}
