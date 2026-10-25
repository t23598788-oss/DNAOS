import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin as supabase, getDebtorPartners, getPartnersWithDocumentSummary } from "@/services/supabase/queries"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ partners: [], total: 0, code: scopeResult.code, error: scopeResult.reason }, { status: 403 })
  }
  const scope = scopeResult.scope

  const debtorsOnly = req.nextUrl.searchParams.get("debtorsOnly") === "true"
  const withSummary = req.nextUrl.searchParams.get("withSummary") === "true"

  if (debtorsOnly) {
    try {
      const partners = await getDebtorPartners(scope)
      return NextResponse.json({ partners })
    } catch (e: unknown) {
      console.error("[partners] list query failed:", e instanceof Error ? e.message : e)
      return NextResponse.json({ partners: [] })
    }
  }

  if (withSummary) {
    try {
      const partners = await getPartnersWithDocumentSummary(scope)
      return NextResponse.json({ partners })
    } catch (e: unknown) {
      console.error("[partners] list query failed:", e instanceof Error ? e.message : e)
      return NextResponse.json({ partners: [] })
    }
  }

  // STEP 3 — BUSINESS CONTEXT PARTNER SELECTOR (server-side search + role filter)
  //  ค้น/กรองในฝั่ง server จริง (ไม่โหลดรายชื่อทั้งหมดมา client) — companies ตารางจริง (type = CORE/CUSTOMER/SUPPLIER)
  //  search = ILIKE บนชื่อ/เลขผู้เสียภาษี · type = บทบาท (CUSTOMER=ผู้ซื้อ, SUPPLIER=ผู้จำหน่าย) · limit = ตัดรายการ
  const search = req.nextUrl.searchParams.get("search")?.trim() ?? ""
  const typeFilter = req.nextUrl.searchParams.get("type")?.trim() ?? ""
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 0) || 50, 200)

  let query = supabase()
    .from("companies")
    .select("id, name, type, phone, address, tax_id, email")
    .in("id", scope.companyIds)
    .order("name")
    .limit(limit)
  if (typeFilter) query = query.eq("type", typeFilter.toUpperCase())
  if (search) query = query.or(`name.ilike.%${search}%,tax_id.ilike.%${search}%`)

  const { data, error } = await query

  if (error) {
    console.error("[partners] list query failed:", error.message)
    return NextResponse.json({ partners: [], total: 0, truncated: false })
  }

  const partners = (data ?? []).map((c: any) => ({
    id: c.id,
    code: c.id?.slice(0, 8) ?? "",
    name: c.name ?? "",
    partner_type_label: c.type ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    tax_id: c.tax_id ?? "",
    contact_name: c.email ?? "",
  }))

  return NextResponse.json({ partners, total: partners.length, truncated: partners.length >= limit })
}
