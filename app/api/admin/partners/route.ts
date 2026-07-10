import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getDebtorPartners, getPartnersWithDocumentSummary } from "@/services/supabase/queries"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const debtorsOnly = req.nextUrl.searchParams.get("debtorsOnly") === "true"
  const withSummary = req.nextUrl.searchParams.get("withSummary") === "true"

  if (debtorsOnly) {
    try {
      const partners = await getDebtorPartners()
      return NextResponse.json({ partners })
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
    }
  }

  if (withSummary) {
    try {
      const partners = await getPartnersWithDocumentSummary()
      return NextResponse.json({ partners })
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
    }
  }

  const { data, error } = await supabase()
    .from("companies")
    .select("id, name, type, phone, address, tax_id, email")
    .order("name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  return NextResponse.json({ partners })
}
