import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolvePaymentDocumentLink } from "@/engines/transactions/document-link"
import { confirmPayment } from "@/engines/canonical/payment-write"
import { appendDebtEvent, refreshDebtSnapshotFromLedger } from "@/engines/canonical/debt-write"

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

  // PHASE D4/D9 — the ledger + allocation + projection writes now go through the
  // canonical payment service. The legacy pointer receipt_documents.matched_debt_event_id
  // is still written for compatibility, but the TRUTH is the allocation row.
  const principalPortion = Math.min(amount, outstandingBefore)
  const interestPenaltyPortion = Math.round((amount - principalPortion) * 100) / 100

  let canonical: Awaited<ReturnType<typeof confirmPayment>> | null = null
  try {
    canonical = await confirmPayment({
      receipt_document_id: id,
      allocations: [
        {
          target: { kind: "anchor" },
          allocation_kind: "principal",
          amount: principalPortion,
          note: link.document.note ?? null,
        },
        ...(interestPenaltyPortion > 0
          ? [
              {
                target: { kind: "anchor" as const },
                allocation_kind: "penalty" as const,
                amount: interestPenaltyPortion,
                note: `ดอกเบี้ย/ค่าปรับที่ได้รับพร้อมเงินต้น (สลิป ${doc.reference_number ?? id})`,
              },
            ]
          : []),
      ],
      actor: auth.email,
      debt_event_anchor: {
        event_type: "receipt_received",
        amount: principalPortion,
        note: link.document.note ?? null,
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "ยืนยันการชำระไม่สำเร็จ"
    return NextResponse.json({ error: message }, { status: message.startsWith("PAYMENT_") ? 409 : 500 })
  }

  // split of the real deposit: principal vs interest/penalty (same money, honestly attributed)
  if (interestPenaltyPortion > 0) {
    await appendDebtEvent({
      customer_company_id: String(doc.customer_company_id),
      event_type: "interest_penalty_received",
      amount: interestPenaltyPortion,
      occurred_at: occurredAt,
      note: `ดอกเบี้ย/ค่าปรับที่ได้รับพร้อมเงินต้น (สลิป ${doc.reference_number ?? id}, ยอดรวมที่โอนมาจริง ${amount.toLocaleString("th-TH")} บาท)`,
      source: "line_chat",
      actor: auth.email,
      evidence: { receipt_document_id: id },
    })
    await refreshDebtSnapshotFromLedger(String(doc.customer_company_id), auth.email)
  }

  // legacy compat pointer + human confirmation evidence (the truth stays in payment_allocations)
  await db
    .from("receipt_documents")
    .update({ matched_debt_event_id: canonical.debt_event_id, confirmed_by: auth.email })
    .eq("id", id)

  return NextResponse.json({
    ok: true,
    debt_event_id: canonical.debt_event_id,
    amount_deducted: amount,
    payment_kind: link.kind,
    document: link.document,
    canonical,
  })
}
