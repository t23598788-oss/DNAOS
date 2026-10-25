import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { isCompanyInScope } from "@/core/auth/orgScope"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// customer_sites — real delivery addresses. This was the missing piece
// blocking Job creation entirely (customer_orders requires a customer_site_id,
// but there was no UI to create one) — owner instruction 2026-07-10.

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ sites: [], code: scopeResult.code, error: scopeResult.reason }, { status: 403 })
  }
  const companyId = req.nextUrl.searchParams.get("company_id")
  if (!companyId) return NextResponse.json({ error: "ต้องระบุ company_id" }, { status: 400 })
  if (!isCompanyInScope(scopeResult.scope, companyId)) {
    return NextResponse.json({ sites: [], code: "RESOURCE_NOT_OWNED", error: "บริษัทนี้ไม่ได้อยู่ใน organization scope" }, { status: 403 })
  }

  const { data, error } = await supabase()
    .from("customer_sites")
    .select("id, site_name, address, province, district, subdistrict, postal_code, contact_name, contact_phone, is_active")
    .eq("customer_company_id", companyId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[sites] list query failed:", error.message)
    return NextResponse.json({ sites: [] })
  }
  return NextResponse.json({ sites: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ error: "ต้องเลือกองค์กรก่อนสร้างหน้างาน", code: scopeResult.code }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (body?.customer_company_id && !isCompanyInScope(scopeResult.scope, String(body.customer_company_id))) {
    return NextResponse.json({ error: "บริษัทนี้ไม่ได้อยู่ใน organization scope", code: "RESOURCE_NOT_OWNED" }, { status: 403 })
  }
  const required = ["customer_company_id", "site_name", "address", "province", "district", "subdistrict", "postal_code"]
  const missing = required.filter((k) => !body?.[k]?.toString().trim())
  if (missing.length > 0) {
    return NextResponse.json({ error: `ข้อมูลไม่ครบ: ${missing.join(", ")}` }, { status: 400 })
  }

  const { data, error } = await supabase()
    .from("customer_sites")
    .insert({
      customer_company_id: body.customer_company_id,
      site_name: body.site_name,
      address: body.address,
      province: body.province,
      district: body.district,
      subdistrict: body.subdistrict,
      postal_code: body.postal_code,
      contact_name: body.contact_name || null,
      contact_phone: body.contact_phone || null,
      delivery_note: body.delivery_note || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select("id, site_name, address, province, district, subdistrict, postal_code, contact_name, contact_phone")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ site: data })
}
