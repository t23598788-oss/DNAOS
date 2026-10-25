import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { isCompanyInScope } from "@/core/auth/orgScope"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// LINE Profile — Business Evidence context (owner, 2026-07-18): every
// distinct LINE contact, cross-referenced with whatever role/trust profile
// has been set for them (if any) and whatever company they're matched to
// (if any) — read-only list for the /admin/line-profiles management page.
// Same contact-listing pattern as app/api/admin/line-customers/route.ts,
// extended with line_profiles instead of duplicating that route's debt logic
// (this page is about WHO the sender is, not what they owe).

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ error: "ต้องเลือกองค์กรก่อนอ่านรายชื่อ LINE", code: scopeResult.code }, { status: 403 })
  }
  const scope = scopeResult.scope

  const db = supabase()

  // Only LINE identities linked to a company inside this org are this tenant's
  // contacts. Other LINE users are never listed.
  const { data: scopedLinks, error: scopedErr } = await db
    .from("company_line_links")
    .select("line_user_id")
    .in("company_id", scope.companyIds)
  if (scopedErr) return NextResponse.json({ error: scopedErr.message }, { status: 500 })
  const scopedLineUserIds = [...new Set((scopedLinks ?? []).map((l: any) => String(l.line_user_id)))]
  if (scopedLineUserIds.length === 0) return NextResponse.json({ contacts: [] })

  const { data: events, error } = await db
    .from("line_events")
    .select("line_user_id, line_name, line_picture, created_at")
    .in("line_user_id", scopedLineUserIds)
    .order("created_at", { ascending: true })
  if (error) {
    console.error("[line-profiles] list query failed:", error.message)
    return NextResponse.json({ contacts: [] })
  }

  const byUser = new Map<string, { line_user_id: string; line_name: string | null; line_picture: string | null; first_seen_at: string }>()
  for (const e of events ?? []) {
    if (!e.line_user_id) continue
    if (!byUser.has(e.line_user_id)) {
      byUser.set(e.line_user_id, { line_user_id: e.line_user_id, line_name: e.line_name, line_picture: e.line_picture, first_seen_at: e.created_at })
    } else if (e.line_name) {
      const existing = byUser.get(e.line_user_id)!
      if (!existing.line_name) existing.line_name = e.line_name
    }
  }

  const contacts = Array.from(byUser.values())
  const lineUserIds = contacts.map((c) => c.line_user_id)

  const { data: profiles } = lineUserIds.length
    ? await db.from("line_profiles").select("line_user_id, role, company_id, department, trust_level, notes, companies(id, name)").in("line_user_id", lineUserIds)
    : { data: [] }
  const profileByUserId = new Map((profiles ?? []).map((p: any) => [p.line_user_id, p]))

  const { data: links } = lineUserIds.length
    ? await db.from("company_line_links").select("line_user_id, companies(id, name)").in("line_user_id", lineUserIds).in("company_id", scope.companyIds)
    : { data: [] }
  const companyByUserId = new Map((links ?? []).filter((l: any) => l.companies).map((l: any) => [l.line_user_id, l.companies]))

  const result = contacts.map((c) => {
    const profile = profileByUserId.get(c.line_user_id)
    const matchedCompany = companyByUserId.get(c.line_user_id) ?? null
    // A profile company outside this org is not disclosed.
    const profileCompany = profile && isCompanyInScope(scope, profile.company_id) ? profile.companies ?? null : null
    return {
      ...c,
      role: profile?.role ?? null,
      department: profile?.department ?? null,
      trust_level: profile?.trust_level ?? null,
      notes: profile?.notes ?? null,
      profile_company: profileCompany,
      matched_company: matchedCompany,
    }
  })

  return NextResponse.json({ contacts: result })
}
