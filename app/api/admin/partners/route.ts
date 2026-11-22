import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase, getDebtorPartners, getPartnersWithDocumentSummary } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  const debtorsOnly = req.nextUrl.searchParams.get("debtorsOnly") === "true"
  const withSummary = req.nextUrl.searchParams.get("withSummary") === "true"

  if (debtorsOnly) {
    try {
      const partners = await getDebtorPartners(ctx.scope)
      return NextResponse.json({ partners })
    } catch (e: unknown) {
      console.error("[partners] list query failed:", e instanceof Error ? e.message : e)
      return NextResponse.json({ partners: [] })
    }
  }

  if (withSummary) {
    try {
      const partners = await getPartnersWithDocumentSummary(ctx.scope)
      return NextResponse.json({ partners })
    } catch (e: unknown) {
      console.error("[partners] list query failed:", e instanceof Error ? e.message : e)
      return NextResponse.json({ partners: [] })
    }
  }

  if (ctx.companyIds && ctx.companyIds.size === 0) return NextResponse.json({ partners: [] })
  let query = supabase()
    .from("companies")
    .select("id, name, type, phone, address, tax_id, email")
    .order("name")
  if (ctx.companyIds) query = query.in("id", [...ctx.companyIds])
  const { data, error } = await query

  if (error) {
    console.error("[partners] list query failed:", error.message)
    return NextResponse.json({ partners: [] })
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

  return NextResponse.json({ partners })
}
