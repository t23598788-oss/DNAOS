import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// Payment Verification Engine — Phase 1 (owner, 2026-07-18): the ONLY place
// a LINE-slip classification (receipt_documents, status "ai_read" = Pending
// Review under this table's pre-existing 3-state vocabulary) turns into a
// real receipt_received debt event. A human clicking this button IS the
// confirmation Rule 72 requires — no second evidence source exists yet to
// auto-verify (bank email/gateway/statement feeds are all unbuilt, see the
// migration header), so every transfer_slip stays Pending Review until a
// person here says otherwise. Never auto-executed.
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
  if (doc.document_type !== "transfer_slip") {
    return NextResponse.json({ error: "ยืนยันได้เฉพาะสลิปโอนเงินเท่านั้น" }, { status: 400 })
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

  const { data: event, error: eventErr } = await db
    .from("debt_events")
    .insert({
      customer_company_id: doc.customer_company_id,
      event_type: "receipt_received",
      amount,
      occurred_at: occurredAt,
      note: doc.reference_number ? `สลิปโอนเงิน อ้างอิง ${doc.reference_number}` : "สลิปโอนเงิน (ไม่มีเลขอ้างอิง)",
      source: "line_chat",
      created_by: auth.email,
    })
    .select("id")
    .single()
  if (eventErr) return NextResponse.json({ error: eventErr.message }, { status: 500 })

  // Debt Tracking Model is the Single Source of Truth (owner, 2026-07-17/18)
  // — principal reduces immediately on a confirmed receipt, per the owner's
  // event flow. Clamped at 0 rather than going negative; an overpayment case
  // isn't handled here (out of scope for this pass — flagged, not silently
  // wrong).
  const { data: snapshot } = await db
    .from("debt_snapshots")
    .select("total_outstanding")
    .eq("customer_company_id", doc.customer_company_id)
    .maybeSingle()
  if (snapshot) {
    const newOutstanding = Math.max(0, Number(snapshot.total_outstanding ?? 0) - amount)
    await db.from("debt_snapshots")
      .update({ total_outstanding: newOutstanding, updated_at: new Date().toISOString() })
      .eq("customer_company_id", doc.customer_company_id)
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

  return NextResponse.json({ ok: true, debt_event_id: event.id, amount_deducted: amount })
}
