import { NextRequest, NextResponse } from "next/server"
import { supabase, getDebtorPartners, getPartnersWithDocumentSummary } from "@/lib/supabase/queries"

export async function GET(req: NextRequest) {
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
    .from("partners")
    .select("id, code, name, partner_type_label, phone, address, tax_id, contact_name")
    .is("deleted_at", null)
    .order("name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ partners: data ?? [] })
}
