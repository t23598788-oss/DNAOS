import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ relationshipId: string }> }

// "New customers never disappear" (owner, 2026-07-18) — the deliberate human
// action that promotes an unmatched LINE contact into a real relationship.
// Nothing in this codebase creates company_line_links automatically (that
// gap is exactly what made new leads invisible) — this route IS the one
// intentional write path, always admin-triggered (Rule 72), never automatic.
//
// body: { companyId: string } to link to an existing company, OR
//       { newCompany: { name, phone?, taxId? } } to create one first.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { relationshipId: lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const db = supabase()

  let companyId: string | undefined = body.companyId

  if (!companyId && body.newCompany?.name) {
    const { data: newCompany, error: createErr } = await db
      .from("companies")
      .insert({
        name: body.newCompany.name,
        phone: body.newCompany.phone || null,
        tax_id: body.newCompany.taxId || null,
        type: "customer",
      })
      .select("id")
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    companyId = newCompany.id
  }

  if (!companyId) {
    return NextResponse.json({ error: "ต้องระบุ companyId หรือ newCompany.name" }, { status: 400 })
  }

  const { data: existing } = await db
    .from("company_line_links").select("company_id").eq("line_user_id", lineUserId).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `ผู้ติดต่อนี้จับคู่กับบริษัทอื่นอยู่แล้ว (${existing.company_id})` }, { status: 400 })
  }

  const { error: linkErr } = await db.from("company_line_links").insert({ company_id: companyId, line_user_id: lineUserId })
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, companyId })
}
