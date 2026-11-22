import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"
import {
  requestPartnerPayable,
  transitionPartnerPayable,
  type PayableTransitionTarget,
} from "@/engines/canonical/expense-write"

// Admin payable workflow (UNIFIED FINANCE ADMIN mission, 2026-10-11) — คำขอจ่าย
// เงินพาร์ตเนอร์ของหน้าจอ Admin ใช้ canonical expense writer ตัวเดียวกับ
// LINE tier (D3): POST → requestPartnerPayable (status เริ่ม pending เสมอ —
// writer เป็นเจ้าของ status · Rule 72) · PATCH → transitionPartnerPayable
// (closed vocabulary + row-filtered update, fail-closed)
// paid_confirmed/completed ต้องมีหลักฐานธนาคารจริง (bank_email_verified=true
// + บรรยายหลักฐาน) — route บังคับเองด้วย กันคนกรอกกดมั่ว; completed_at
// ยังถูก derive โดย writer เท่านั้น (verified เท่านั้นถึงมีค่า)

const TRANSITION_TARGETS: PayableTransitionTarget[] = ["owner_acknowledged", "completed", "paid_confirmed"]

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth
  const scope = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return denied
  if (scope.companyIds.size === 0) return NextResponse.json({ items: [] })

  const params = req.nextUrl.searchParams
  const limit = Math.min(Number(params.get("limit") ?? 100), 300)
  const status = params.get("status")

  let query = supabase()
    .from("partner_payable_requests")
    .select(
      "id, partner_company_id, partner_name, amount, description, status, owner_notified_at, owner_acknowledged_at, bank_email_verified, completed_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
  if (status) query = query.eq("status", status)
  query = query.in("partner_company_id", [...scope.companyIds])

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const partnerName = strOrNull(body?.partner_name)
  const amount = typeof body?.amount === "number" && Number.isFinite(body.amount) ? body.amount : null
  if (!partnerName) return NextResponse.json({ error: "ต้องระบุชื่อพาร์ตเนอร์", code: "PAYABLE_PARTNER_REQUIRED" }, { status: 400 })
  if (amount === null || amount <= 0) {
    return NextResponse.json({ error: "จำนวนเงินต้องมากกว่า 0", code: "PAYABLE_AMOUNT_INVALID" }, { status: 400 })
  }

  // identity: ถ้าระบุ partner_company_id ต้องเป็นบริษัท/บุคคลที่มีอยู่จริง (T04)
  const partnerCompanyId = strOrNull(body?.partner_company_id)
  if (!partnerCompanyId) {
    return NextResponse.json({ error: "ต้องระบุบริษัทคู่ค้าที่อยู่ในองค์กรของท่าน", code: "PAYABLE_COMPANY_REQUIRED" }, { status: 400 })
  }
  const scope = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return denied
  if (!isCompanyVisible(scope, partnerCompanyId)) return notFound()
  if (partnerCompanyId) {
    const { data: company } = await supabase().from("companies").select("id").eq("id", partnerCompanyId).maybeSingle()
    if (!company) {
      return NextResponse.json({ error: "ไม่พบบริษัท/บุคคลนี้ในระบบ — เลือกรายการที่มีอยู่เท่านั้น", code: "PAYABLE_COMPANY_NOT_FOUND" }, { status: 400 })
    }
  }

  try {
    const created = await requestPartnerPayable({
      partner_company_id: partnerCompanyId,
      partner_name: partnerName,
      amount,
      description: strOrNull(body?.description),
      actor: auth.email,
      provenance: { channel: "admin_manual", received_via: "app:admin-finance" },
    })
    return NextResponse.json({ payable: created }, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "สร้างคำขอจ่ายเงินไม่สำเร็จ"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(req: Request) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const payableId = strOrNull(body?.payable_id)
  const to = strOrNull(body?.to) as PayableTransitionTarget | null
  if (!payableId || !to || !TRANSITION_TARGETS.includes(to)) {
    return NextResponse.json(
      { error: `payable_id และ to (${TRANSITION_TARGETS.join("/")}) ต้องระบุ`, code: "PAYABLE_TRANSITION_INPUT_INVALID" },
      { status: 400 },
    )
  }
  const scope = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return denied
  const { data: payableOwner } = await supabase()
    .from("partner_payable_requests")
    .select("partner_company_id")
    .eq("id", payableId)
    .maybeSingle()
  if (!isCompanyVisible(scope, payableOwner?.partner_company_id)) return notFound()

  // paid_confirmed/completed = ยืนยันว่าจ่ายเงินจริงแล้ว — ต้องมีหลักฐานธนาคาร
  // จริงเท่านั้น (writer เองก็ derive completed_at จาก flag นี้คนเดียว)
  const wantsPaidEvidence = to === "paid_confirmed" || to === "completed"
  const evidenceNote = strOrNull(body?.bank_email_evidence)
  if (wantsPaidEvidence && !evidenceNote) {
    return NextResponse.json(
      { error: "การยืนยันว่าจ่ายเงินแล้วต้องแนบบรรยายหลักฐานธนาคารจริง (อีเมลธนาคาร/สลิปอ้างอิง) เท่านั้น", code: "PAYABLE_EVIDENCE_REQUIRED" },
      { status: 400 },
    )
  }

  try {
    const result = await transitionPartnerPayable({
      payable_id: payableId,
      to,
      bank_email_verified: wantsPaidEvidence,
      actor: auth.email,
      provenance: {
        channel: "admin_manual",
        received_via: "app:admin-finance",
        bank_evidence_note: evidenceNote,
      },
    })
    return NextResponse.json({ payable: result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "อัปเดตคำขอจ่ายเงินไม่สำเร็จ"
    return NextResponse.json({ error: message }, { status: message.startsWith("PAYABLE_") ? 400 : 500 })
  }
}
