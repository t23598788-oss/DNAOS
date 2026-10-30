import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
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

  const db = supabase()

  const { data: events, error } = await db
    .from("line_events")
    .select("line_user_id, line_name, line_picture, created_at")
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
    ? await db.from("line_profiles").select("line_user_id, role, company_id, department, trust_level, notes, permissions, companies(id, name)").in("line_user_id", lineUserIds)
    : { data: [] }
  const profileByUserId = new Map((profiles ?? []).map((p: any) => [p.line_user_id, p]))

  const { data: links } = lineUserIds.length
    ? await db.from("company_line_links").select("line_user_id, companies(id, name)").in("line_user_id", lineUserIds)
    : { data: [] }
  const companyByUserId = new Map((links ?? []).filter((l: any) => l.companies).map((l: any) => [l.line_user_id, l.companies]))

  const result = contacts.map((c) => {
    const profile = profileByUserId.get(c.line_user_id)
    const matchedCompany = companyByUserId.get(c.line_user_id) ?? null
    return {
      ...c,
      role: profile?.role ?? null,
      department: profile?.department ?? null,
      trust_level: profile?.trust_level ?? null,
      notes: profile?.notes ?? null,
      // Contact Settings (M025): consent to receive debt-tracking messages lives
      // in the canonical identity permissions object, not in a second flag table.
      permissions: profile?.permissions ?? {},
      profile_company: profile?.companies ?? null,
      matched_company: matchedCompany,
    }
  })

  return NextResponse.json({ contacts: result })
}
