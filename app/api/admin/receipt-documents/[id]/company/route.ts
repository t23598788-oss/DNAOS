import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { recordCanonicalAudit } from "@/engines/canonical/audit"

// Receipt debtor assignment (BATCH 33) — the ONE approved write path for
// receipt_documents.customer_company_id when automatic identity resolution
// cannot decide (e.g. slips forwarded through an internal LINE account).
//
//   · Admin picks the debtor themselves from EXISTING companies/person rows
//     (companies.is_individual covers person debtors) — never from OCR,
//     never from a name-similarity guess.
//   · Gate: only status=ai_read (pre-confirm) receipts can be assigned —
//     a confirmed receipt already anchored money in the ledger.
//   · Writes through this route only + recordCanonicalAudit (who assigned)
//     — payment RPC / receipt-confirm-flow untouched: after assignment the
//     existing confirm button works unchanged.
//   · The auto backfill in receipt-reconcile-sweep remains the automatic
//     path (line identity based); this is the manual counterpart for rows
//     that path cannot resolve.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const companyId = typeof body?.customer_company_id === "string" ? body.customer_company_id.trim() : ""
  if (!companyId) {
    return NextResponse.json({ error: "ต้องระบุ customer_company_id จากบริษัท/บุคคลที่มีอยู่แล้ว", code: "COMPANY_REQUIRED" }, { status: 400 })
  }

  const db = supabase()
  const { data: receipt, error: rErr } = await db
    .from("receipt_documents")
    .select("id, status, customer_company_id, amount")
    .eq("id", id)
    .maybeSingle()
  if (rErr || !receipt) {
    return NextResponse.json({ error: rErr?.message ?? "ไม่พบสลิปรายการนี้", code: "RECEIPT_NOT_FOUND" }, { status: 404 })
  }
  if (receipt.status !== "ai_read") {
    return NextResponse.json({
      error: `แก้คู่ค้าได้เฉพาะสลิปที่ยังรอตรวจสอบ (ai_read) — สถานะปัจจุบัน: ${receipt.status}`,
      code: "RECEIPT_NOT_ASSIGNABLE",
    }, { status: 409 })
  }
  const { data: company } = await db.from("companies").select("id, name").eq("id", companyId).maybeSingle()
  if (!company) {
    return NextResponse.json({ error: "ไม่พบบริษัท/บุคคลนี้ในทะเบียน — เลือกจากรายการที่มีอยู่เท่านั้น", code: "COMPANY_NOT_FOUND" }, { status: 400 })
  }

  const { error: upErr } = await db
    .from("receipt_documents")
    .update({ customer_company_id: companyId, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await recordCanonicalAudit({
    action: "document.updated",
    entity_type: "receipt_document",
    entity_id: id,
    actor: auth.email ?? auth.id,
    field: "customer_company_id",
    old_value: receipt.customer_company_id ?? null,
    new_value: companyId,
    evidence: {
      reason: "admin debtor assignment (manual)",
      assigned_by: auth.email ?? auth.id,
      receipt_status: receipt.status,
      amount: receipt.amount,
    },
  })

  return NextResponse.json({ ok: true, customer_company_id: companyId, company_name: company.name })
}
