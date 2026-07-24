import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolvePaymentDocumentLink } from "@/engines/transactions/document-link"

// Payment Verification Queue — list (owner, 2026-07-24): the OCR slip pipeline
// (supabase/functions/line-webhook-v2/handlers/image.ts) has been writing
// transfer_slip rows into receipt_documents since 2026-07-17, and the confirm
// endpoint (./[id]/confirm/route.ts) has existed since 2026-07-18 — but
// nothing ever listed these rows for a human to see. This is that missing
// read side, wired to the same resolvePaymentDocumentLink() pure function
// that already decides full vs. partial payment (engines/transactions/
// document-link.ts), so the preview shown here is the exact same
// classification confirm will act on, not a separate guess.
export async function GET(_req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  // Real incident found 2026-07-24 (บจก. เคที คอนสตรัคชั่น, ฿5,000 slip):
  // ocr-classify.ts treats "payment_advice" as an equally real incoming-
  // payment type alongside "transfer_slip" (same business_category/workflow
  // in its own DOCUMENT_TYPE_PROFILE) — this list only showed transfer_slip,
  // so a real payment classified as payment_advice never appeared here at
  // all, invisible to any human review.
  const { data: docs, error } = await db
    .from("receipt_documents")
    .select("id, amount, transaction_datetime, document_date, customer_company_id, sender_name, reference_number, status, verification_level, created_at")
    .in("document_type", ["transfer_slip", "payment_advice"])
    .eq("status", "ai_read")
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const companyIds = [...new Set((docs ?? []).map((d) => d.customer_company_id).filter(Boolean))] as string[]
  const { data: companies } = companyIds.length
    ? await db.from("companies").select("id, name").in("id", companyIds)
    : { data: [] as { id: string; name: string }[] }
  const companyById = new Map((companies ?? []).map((c) => [c.id, c.name]))

  const { data: snapshots } = companyIds.length
    ? await db.from("debt_snapshots").select("customer_company_id, total_outstanding").in("customer_company_id", companyIds)
    : { data: [] as { customer_company_id: string; total_outstanding: number }[] }
  const outstandingByCompany = new Map((snapshots ?? []).map((s) => [s.customer_company_id, Number(s.total_outstanding ?? 0)]))

  const items = (docs ?? []).map((d) => {
    const partnerName = d.customer_company_id ? companyById.get(d.customer_company_id) : undefined
    const outstanding = d.customer_company_id ? outstandingByCompany.get(d.customer_company_id) ?? 0 : 0
    const link = d.amount
      ? resolvePaymentDocumentLink({
          amount: Number(d.amount),
          transactionOutstanding: outstanding,
          transactionId: d.customer_company_id,
          partnerName,
          reference: d.reference_number ?? undefined,
        })
      : null
    return {
      id: d.id,
      amount: d.amount,
      sender_name: d.sender_name,
      reference_number: d.reference_number,
      transaction_datetime: d.transaction_datetime ?? d.document_date,
      verification_level: d.verification_level,
      customer_company_id: d.customer_company_id,
      partner_name: partnerName ?? null,
      outstanding_before: outstanding,
      payment_preview: link
        ? { kind: link.kind, title: link.document.title, note: link.document.note }
        : null,
    }
  })

  return NextResponse.json({ items })
}
