import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { recordCompanyExpense } from "@/engines/canonical/expense-write"

// Admin expense entry (UNIFIED FINANCE ADMIN mission, 2026-10-11) — หน้าจอ Admin
// กรอกค่าใช้จ่ายต้องเข้าสู่ Cost Ledger เดียวกับ LINE chat / subscription sync:
//   POST → engines/canonical/expense-write#recordCompanyExpense (canonical
//   writer ตัวเดียว + recordCanonicalAudit) — ไม่มี insert ตรงที่ route นี้
// Rule: แถวค่าใช้จ่าย = หลักฐานบิล/ใบกำกับ (evidence) ไม่ใช่การยืนยันจ่ายเงิน
// — การจ่ายจริงของพาร์ตเนอร์อยู่ที่ partner_payable_requests + bank evidence
// (ดู /api/admin/payables) · source = 'admin_manual' เพื่อให้ตรวจสอบย้อนหลังได้
// ว่าแถวมาจากหน้าจอนี้ (metadata เท่านั้น ไม่เปลี่ยนหลักการบันทึกบัญชี)

/** ชนิดเอกสารค่าใช้จ่ายที่ระบบมีจริงใน production (ค่าจาก company_expenses เดิม) */
const ALLOWED_DOCUMENT_TYPES = [
  "tax_invoice",
  "invoice",
  "receipt",
  "fuel_bill",
  "partner_payable",
  "other",
] as const

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const params = req.nextUrl.searchParams
  const limit = Math.min(Number(params.get("limit") ?? 100), 300)
  const documentType = params.get("document_type")
  const vendor = params.get("vendor")
  const dateFrom = params.get("date_from")
  const dateTo = params.get("date_to")
  const q = params.get("q")

  let query = supabase()
    .from("company_expenses")
    .select(
      "id, document_type, amount, amount_pre_vat, vat_amount, vendor_name, expense_date, tax_invoice_no, notes, source, submitted_by_name, receipt_document_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
  if (documentType) query = query.eq("document_type", documentType)
  if (vendor) query = query.ilike("vendor_name", `%${vendor}%`)
  if (dateFrom) query = query.gte("expense_date", dateFrom)
  if (dateTo) query = query.lte("expense_date", dateTo)
  if (q) query = query.or(`vendor_name.ilike.%${q}%,notes.ilike.%${q}%,tax_invoice_no.ilike.%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const documentType = strOrNull(body?.document_type)
  const amount = numOrNull(body?.amount)
  if (!documentType || !ALLOWED_DOCUMENT_TYPES.includes(documentType as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
    return NextResponse.json(
      { error: `document_type ต้องเป็นหนึ่งใน ${ALLOWED_DOCUMENT_TYPES.join(", ")}`, code: "EXPENSE_DOCUMENT_TYPE_INVALID" },
      { status: 400 },
    )
  }
  if (amount === null || amount <= 0) {
    return NextResponse.json({ error: "จำนวนเงินต้องมากกว่า 0", code: "EXPENSE_AMOUNT_INVALID" }, { status: 400 })
  }

  try {
    const created = await recordCompanyExpense({
      document_type: documentType,
      amount,
      vendor_name: strOrNull(body?.vendor_name),
      expense_date: strOrNull(body?.expense_date),
      receipt_document_id: strOrNull(body?.receipt_document_id),
      // admin กรอกเอง — ไม่มี LINE sender จริง ห้ามปลอมแปลงคอลัมน์ line
      submitted_by_line_user_id: null,
      submitted_by_name: auth.email,
      submitted_by_role: null,
      source: "admin_manual",
      amount_pre_vat: numOrNull(body?.amount_pre_vat),
      vat_amount: numOrNull(body?.vat_amount),
      tax_invoice_no: strOrNull(body?.tax_invoice_no),
      notes: strOrNull(body?.notes),
      actor: auth.email,
      provenance: {
        channel: "admin_manual",
        received_via: "app:admin-finance",
        evidence_media_path: strOrNull(body?.evidence_media_path),
      },
    })
    return NextResponse.json({ expense: created }, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "บันทึกค่าใช้จ่ายไม่สำเร็จ"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
