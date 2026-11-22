import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import {
  applyUnifiedFilters,
  normalizeAllocation,
  normalizeExpense,
  normalizeIncomeEvidence,
  normalizePayable,
  type UnifiedRow,
} from "@/services/finance/unified-list"

// Unified financial transaction list (UNIFIED FINANCE ADMIN mission, 2026-10-11):
// รายการการเงินทั้งหมดจาก canonical tables เดียวกับที่ระบบอัตโนมัติใช้ —
// ไม่มีตาราง manual แยก ไม่มี writer ใหม่ (route นี้อ่านอย่างเดียว):
//   receipt_documents + payment_allocations + company_expenses + partner_payable_requests
// Manual กับ Automation แสดงร่วมกัน — ต่างกันแค่ source metadata (channel/source)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const params = req.nextUrl.searchParams
  const db = supabase()
  const limit = Math.min(Number(params.get("limit") ?? 200), 500)

  const [receiptsRes, allocRes, expensesRes, payablesRes] = await Promise.all([
    db
      .from("receipt_documents")
      .select(
        "id, document_type, amount, document_date, transaction_datetime, created_at, sender_name, reference_number, status, source_channel, confirmed_by, companies:customer_company_id(name)",
      )
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("payment_allocations")
      .select(
        "id, amount, allocated_at, receipt_document_id, receipt_documents:receipt_document_id(reference_number), invoices:invoice_id(invoice_no, customer_company_id, companies:customer_company_id(name))",
      )
      .order("allocated_at", { ascending: false })
      .limit(limit),
    db
      .from("company_expenses")
      .select("id, document_type, amount, expense_date, created_at, vendor_name, tax_invoice_no, source, submitted_by_name, receipt_document_id")
      .neq("source", "subscription_email_sync")
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("partner_payable_requests")
      .select("id, amount, created_at, partner_name, description, status, bank_email_verified")
      .order("created_at", { ascending: false })
      .limit(limit),
  ])

  const queryErrors = [receiptsRes.error, allocRes.error, expensesRes.error, payablesRes.error].filter(Boolean)
  if (queryErrors.length > 0) {
    return NextResponse.json({ error: queryErrors[0]?.message ?? "query failed" }, { status: 500 })
  }


  const receipts = (receiptsRes.data ?? []).map((r: Record<string, unknown>) => {
    const companies = r.companies as { name?: string } | { name?: string }[] | null
    const companyName = Array.isArray(companies) ? companies[0]?.name ?? null : companies?.name ?? null
    return {
      id: String(r.id),
      document_type: (r.document_type as string) ?? null,
      amount: r.amount as number | null,
      document_date: (r.document_date as string) ?? null,
      transaction_datetime: (r.transaction_datetime as string) ?? null,
      created_at: String(r.created_at),
      sender_name: (r.sender_name as string) ?? null,
      customer_company_name: companyName,
      reference_number: (r.reference_number as string) ?? null,
      status: String(r.status),
      source_channel: (r.source_channel as string) ?? null,
      confirmed_by: (r.confirmed_by as string) ?? null,
    }
  })

  const allocations = (allocRes.data ?? []).map((a: Record<string, unknown>) => {
    const invoices = a.invoices as { invoice_no?: string; companies?: { name?: string } | { name?: string }[] } | null
    const companies = invoices?.companies ?? null
    const companyName = Array.isArray(companies) ? companies[0]?.name ?? null : companies?.name ?? null
    return {
      id: String(a.id),
      amount: a.amount as number,
      allocated_at: (a.allocated_at as string) ?? null,
      receipt_id: (a.receipt_document_id as string) ?? null,
      receipt_reference: (a.receipt_documents as { reference_number?: string } | null)?.reference_number ?? null,
      invoice_number: invoices?.invoice_no ?? null,
      customer_company_name: companyName,
    }
  })

  const expenses = (expensesRes.data ?? []).map((e: Record<string, unknown>) => ({
    id: String(e.id),
    document_type: (e.document_type as string) ?? null,
    amount: e.amount as number | null,
    expense_date: (e.expense_date as string) ?? null,
    created_at: String(e.created_at),
    vendor_name: (e.vendor_name as string) ?? null,
    tax_invoice_no: (e.tax_invoice_no as string) ?? null,
    source: (e.source as string) ?? null,
    submitted_by_name: (e.submitted_by_name as string) ?? null,
    receipt_document_id: (e.receipt_document_id as string) ?? null,
  }))

  const payables = (payablesRes.data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    amount: p.amount as number,
    created_at: String(p.created_at),
    partner_name: (p.partner_name as string) ?? null,
    description: (p.description as string) ?? null,
    status: String(p.status),
    bank_email_verified: (p.bank_email_verified as boolean) ?? null,
  }))

  const merged: UnifiedRow[] = [
    ...receipts.map(normalizeIncomeEvidence),
    ...allocations.map(normalizeAllocation),
    ...expenses.map(normalizeExpense),
    ...payables.map(normalizePayable),
  ]

  const items = applyUnifiedFilters(merged, {
    direction: (params.get("direction") as "in" | "out" | null) ?? null,
    kind: (params.get("kind") as UnifiedRow["kind"] | null) ?? null,
    status: params.get("status"),
    q: params.get("q"),
    date_from: params.get("date_from"),
    date_to: params.get("date_to"),
    limit,
  })

  return NextResponse.json({
    items,
    basis:
      "canonical tables เดียวกันทุก channel: receipt_documents + payment_allocations + company_expenses + partner_payable_requests — source เป็นเพียง metadata ไม่ใช่บัญชีคนละชุด",
  })
}
