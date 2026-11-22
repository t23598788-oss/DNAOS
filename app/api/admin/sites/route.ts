import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

// customer_sites — real delivery addresses. This was the missing piece
// blocking Job creation entirely (customer_orders requires a customer_site_id,
// but there was no UI to create one) — owner instruction 2026-07-10.

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const companyId = req.nextUrl.searchParams.get("company_id")
  if (!companyId) return NextResponse.json({ error: "ต้องระบุ company_id" }, { status: 400 })

  // Organization scope (WAVE 2): the query string is a request, not a grant.
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (!isCompanyVisible(ctx, companyId)) return notFound()

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
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
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
