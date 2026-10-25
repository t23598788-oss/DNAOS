import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Financial audit trail (UNIFIED FINANCE ADMIN mission, 2026-10-11) — อ่าน
// audit_logs (canonical audit owner เดิม engines/canonical/audit.ts) สำหรับ
// หน้า "ประวัติการดำเนินงาน": ทุกการเขียนการเงิน canonical ทุก channel
// (LINE/อัตโนมัติ/Admin) ลง audit ตัวเดียวกัน — อ่านอย่างเดียว ไม่มีการเขียน
const FINANCIAL_ACTIONS = [
  "expense.recorded",
  "payable.requested",
  "payable.transitioned",
  "payment.allocated",
  "payment.reallocated",
  "debt.event_created",
  "document.created",
  "document.updated",
  "document.issued",
  "document.voided",
  "receipt.acknowledged",
  "transaction.status_changed",
] as const

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const params = req.nextUrl.searchParams
  const limit = Math.min(Number(params.get("limit") ?? 100), 300)
  const action = params.get("action")
  const entityType = params.get("entity_type")

  let query = supabase()
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, company_id, field, old_value, new_value, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (action) query = query.eq("action", action)
  else query = query.in("action", FINANCIAL_ACTIONS)
  if (entityType) query = query.eq("entity_type", entityType)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], actions: FINANCIAL_ACTIONS })
}
