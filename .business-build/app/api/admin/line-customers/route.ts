import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Cross-reference view: every distinct LINE contact, their message history,
// and — where the LINE display name matches a real company/partner record —
// that company's debt status. Read-only, built entirely from tables already
// populated this session (line_events + companies + debt_snapshots). No new
// business capability, no writes.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ error: "ต้องเลือกองค์กรก่อนอ่านรายชื่อลูกค้า LINE", code: scopeResult.code }, { status: 403 })
  }
  const scope = scopeResult.scope

  const db = supabase()

  // Scope the LINE identities through the real company link first. Events from
  // LINE users that are not linked to a company in this organization are not
  // this tenant's contacts and must never be listed.
  const { data: scopedLinks, error: linkError } = await db
    .from("company_line_links")
    .select("line_user_id")
    .in("company_id", scope.companyIds)
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })
  const scopedLineUserIds = [...new Set((scopedLinks ?? []).map((l: any) => String(l.line_user_id)))]
  if (scopedLineUserIds.length === 0) return NextResponse.json({ contacts: [] })

  const { data: events, error } = await db
    .from("line_events")
    .select("id, line_user_id, line_name, line_picture, raw_type, raw_text, created_at")
    .in("line_user_id", scopedLineUserIds)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byUser = new Map<string, {
    line_user_id: string
    line_name: string | null
    line_picture: string | null
    message_count: number
    first_message_at: string
    last_message_at: string
    last_message: string
  }>()

  for (const e of events ?? []) {
    if (!e.line_user_id) continue
    const existing = byUser.get(e.line_user_id)
    if (!existing) {
      byUser.set(e.line_user_id, {
        line_user_id: e.line_user_id,
        line_name: e.line_name,
        line_picture: e.line_picture,
        message_count: 1,
        first_message_at: e.created_at,
        last_message_at: e.created_at,
        last_message: e.raw_text || (e.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : e.raw_type === "image" ? "(ส่งรูปภาพ)" : e.raw_type),
      })
    } else {
      existing.message_count += 1
      existing.last_message_at = e.created_at
      existing.last_message = e.raw_text || (e.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : e.raw_type === "image" ? "(ส่งรูปภาพ)" : e.raw_type)
      if (!existing.line_name && e.line_name) existing.line_name = e.line_name
      if (!existing.line_picture && e.line_picture) existing.line_picture = e.line_picture
    }
  }

  const contacts = Array.from(byUser.values())
  const lineUserIds = contacts.map((c) => c.line_user_id)
  const names = contacts.map((c) => c.line_name).filter((n): n is string => !!n)

  // Match by direct link first (owner-confirmed — a real person can have
  // MORE THAN ONE LINE account, e.g. ช่างมิก added a second LINE account
  // 2026-07-10, so this is a many-links-to-one-company table, not a single
  // column) — only fall back to matching by exact display name if no direct
  // link exists.
  const { data: links } = lineUserIds.length
    ? await db.from("company_line_links").select("line_user_id, companies(id, name, tax_id, phone)").in("line_user_id", lineUserIds).in("company_id", scope.companyIds)
    : { data: [] }
  const { data: namedCompanies } = names.length
    ? await db.from("companies").select("id, name, tax_id, phone").in("name", names).in("id", scope.companyIds)
    : { data: [] }

  const companyByLineUserId = new Map(
    (links ?? []).filter((l: any) => l.companies).map((l: any) => [l.line_user_id as string, l.companies])
  )
  const companyByName = new Map((namedCompanies ?? []).map((c) => [c.name, c]))
  const allCompanyIds = [...companyByLineUserId.values(), ...(namedCompanies ?? [])].map((c: any) => c.id)

  const { data: debts } = allCompanyIds.length
    ? await db.from("company_debt_current").select("company_id, ledger_outstanding, ledger_event_count, snapshot_collection_state, snapshot_days_overdue").in("company_id", allCompanyIds)
    : { data: [] }

  // PHASE E5.2 — the debt figure is the canonical ledger projection
  // (company_debt_current). Interest/penalty are NOT recomputed here any more:
  // that duplicate maths lived in the legacy debt calculator and made this list
  // disagree with the ledger. Overdue days come from the snapshot projection.
  const debtByCompanyId = new Map(
    (debts ?? []).map((d) => [
      String(d.company_id),
      {
        total_outstanding: Number(d.ledger_outstanding ?? 0),
        collection_state: d.snapshot_collection_state,
        days_overdue: Number(d.snapshot_days_overdue ?? 0),
        ledger_event_count: Number(d.ledger_event_count ?? 0),
      },
    ]),
  )

  // Outbound messages waiting on human approval (Rule 72) — flagged per
  // contact so the row itself shows red before anyone even expands it.
  const { data: pendingDrafts } = lineUserIds.length
    ? await db.from("line_outbound_drafts").select("line_user_id").eq("status", "pending_review").in("line_user_id", lineUserIds)
    : { data: [] }
  const pendingByUserId = new Set((pendingDrafts ?? []).map((d) => d.line_user_id))

  const result = contacts
    .map((c) => {
      const company = companyByLineUserId.get(c.line_user_id) ?? (c.line_name ? companyByName.get(c.line_name) : null)
      const debt = company ? debtByCompanyId.get(company.id) : null
      return {
        ...c,
        matched_company: company
          ? { id: company.id, name: company.name, tax_id: company.tax_id, phone: company.phone }
          : null,
        debt: debt ?? null,
        has_pending_draft: pendingByUserId.has(c.line_user_id),
      }
    })
    .sort((a, b) => {
      if (a.has_pending_draft !== b.has_pending_draft) return a.has_pending_draft ? -1 : 1
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    })

  return NextResponse.json({ contacts: result })
}
