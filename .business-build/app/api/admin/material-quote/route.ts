import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { isCompanyInScope } from "@/core/auth/orgScope"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin } from "@/services/supabase/queries"
import { dispatch } from "@/engines/validation/dispatcher"

// ACTIVATE — Material Calculation บน /biz (2026-10-13)
// เปิดให้ Business Workspace เรียก `material.quote` (engine เดิมใน engines/validation/dispatcher)
// ผ่าน transport บาง ๆ นี้ — ไม่สร้าง pricing engine คู่ขนาน, ไม่แตะ LINE path เดิม
// `material.quote` คำนวณอย่างเดียว (resolveMaterial + GPS + pricing + capacity + cost) ไม่เขียน DB
// จึงปลอดภัยใน READ transport — เหมือน /api/v1/mcp/business/dispatch ที่เป็น readonly dispatch
export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabaseAdmin(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ ok: false, code: scopeResult.code, error: scopeResult.reason }, { status: 403 })
  }
  const scope = scopeResult.scope

  const body = await req.json().catch(() => ({}))
  const rawInput = typeof body?.raw_input === "string" ? body.raw_input.trim() : ""
  const quantity = Number(body?.quantity ?? 0)
  const customerId = typeof body?.customer_id === "string" ? body.customer_id : ""

  if (!rawInput || !Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ raw_input และ quantity (>0)" }, { status: 400 })
  }
  if (customerId && !isCompanyInScope(scope, customerId)) {
    return NextResponse.json({ ok: false, code: "RESOURCE_NOT_OWNED", error: "customer_id อยู่นอก organization scope" }, { status: 403 })
  }

  const result = await dispatch("material.quote", { raw_input: rawInput, quantity, customer_id: customerId }, false, { scope })
  return NextResponse.json({ ok: result.ok, command: result.command, data: result.data, violations: result.violations })
}
