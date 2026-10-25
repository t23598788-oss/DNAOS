import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getPartners } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

// Architecture Migration Phase 1 (2026-07-13, owner-directed): the
// relationship list is rooted at `companies` — every real company gets a
// workspace, per the Single Workspace Principle — not at line_events like
// the old /api/admin/line-customers list. LINE presence (zero, one, or
// several linked accounts) becomes an attribute of a relationship instead
// of the thing that determines whether the relationship even appears.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  const db = supabase()
  const companies = await getPartners(ctx.scope)

  let linksQuery = db.from("company_line_links").select("company_id, line_user_id")
  if (ctx.companyIds) linksQuery = linksQuery.in("company_id", [...ctx.companyIds])
  const { data: links } = await linksQuery
  const lineUserIdsByCompany = new Map<string, string[]>()
  const companyIdByLineUserId = new Map<string, string>()
  for (const l of links ?? []) {
    const arr = lineUserIdsByCompany.get(l.company_id) ?? []
    arr.push(l.line_user_id)
    lineUserIdsByCompany.set(l.company_id, arr)
    companyIdByLineUserId.set(l.line_user_id, l.company_id)
  }

  const { data: events, error } = await db
    .from("line_events")
    .select("line_user_id, line_name, line_picture, raw_type, raw_text, created_at")
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  interface LineActivity {
    line_user_id: string
    line_name: string | null
    line_picture: string | null
    message_count: number
    first_message_at: string
    last_message_at: string
    last_message: string
  }
  const activityByLineUserId = new Map<string, LineActivity>()
  for (const e of events ?? []) {
    if (!e.line_user_id) continue
    const text = e.raw_text || (e.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : e.raw_type === "image" ? "(ส่งรูปภาพ)" : e.raw_type)
    const existing = activityByLineUserId.get(e.line_user_id)
    if (!existing) {
      activityByLineUserId.set(e.line_user_id, {
        line_user_id: e.line_user_id, line_name: e.line_name, line_picture: e.line_picture,
        message_count: 1, first_message_at: e.created_at, last_message_at: e.created_at, last_message: text,
      })
    } else {
      existing.message_count += 1
      existing.last_message_at = e.created_at
      existing.last_message = text
      if (!existing.line_name && e.line_name) existing.line_name = e.line_name
      if (!existing.line_picture && e.line_picture) existing.line_picture = e.line_picture
    }
  }

  // STEP 2 (2026-10-25): identity is the explicit link only. The display-name
  // fallback that used to live here could attach a contact — and its debt — to
  // a different company that merely shared the name.

  const allCompanyIds = companies.map((c) => c.id)
  const { data: debts } = allCompanyIds.length
    ? await db
        .from("company_debt_current")
        .select("company_id, ledger_outstanding, ledger_event_count, snapshot_collection_state, snapshot_days_overdue")
        .in("company_id", allCompanyIds)
    : { data: [] }
  // PHASE E5.2 — the debt figure is the canonical ledger projection
  // (company_debt_current). The legacy interest/penalty recalculation is gone:
  // it made this list disagree with the ledger for the same company.
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

  const allLineUserIds = [...companyIdByLineUserId.keys()]
  const { data: pendingDrafts } = allLineUserIds.length
    ? await db.from("line_outbound_drafts").select("line_user_id").eq("status", "pending_review").in("line_user_id", allLineUserIds)
    : { data: [] }
  const pendingLineUserIds = new Set((pendingDrafts ?? []).map((d) => d.line_user_id))

  // "New customers never disappear" (owner, 2026-07-18): a LINE contact who
  // has messaged but has no company match yet must still show up here
  // immediately, not only after an admin manually creates the match. Root
  // cause of the original complaint — this list was filtered to
  // company_line_links-matched contacts only, so a brand-new lead with real
  // messages in line_events was invisible on this page even though nothing
  // was actually lost (still fully captured in line_events). No company or
  // company_line_links row is created automatically here — only the
  // read/display side changes; matching remains a deliberate human action
  // (see POST .../match).
  // A contact with no company is unattributed data: platform-only.
  const unmatchedContacts = (ctx.companyIds === null ? Array.from(activityByLineUserId.values()) : [])
    .filter((a) => !companyIdByLineUserId.has(a.line_user_id))
    .map((a) => ({
      relationship_id: a.line_user_id,
      name: a.line_name ?? `LINE ${a.line_user_id.slice(0, 10)}…`,
      tax_id: null,
      phone: null,
      line_user_ids: [a.line_user_id],
      line_picture: a.line_picture,
      message_count: a.message_count,
      last_message_at: a.last_message_at,
      last_message: a.last_message,
      debt: null,
      has_pending_draft: pendingLineUserIds.has(a.line_user_id),
      unmatched: true,
    }))

  const relationships = companies.map((c) => {
    const lineUserIds = lineUserIdsByCompany.get(c.id) ?? []
    const activities = lineUserIds.map((id) => activityByLineUserId.get(id)).filter((a): a is LineActivity => !!a)
    const mostRecent = activities.length
      ? activities.reduce((a, b) => (a.last_message_at > b.last_message_at ? a : b))
      : null
    const debt = debtByCompanyId.get(c.id) ?? null
    return {
      relationship_id: c.id,
      name: c.name,
      tax_id: c.tax_id ?? null,
      phone: c.phone ?? null,
      line_user_ids: lineUserIds,
      line_picture: mostRecent?.line_picture ?? null,
      message_count: activities.reduce((sum, a) => sum + a.message_count, 0),
      last_message_at: mostRecent?.last_message_at ?? null,
      last_message: mostRecent?.last_message ?? null,
      debt,
      has_pending_draft: lineUserIds.some((id) => pendingLineUserIds.has(id)),
      unmatched: false,
    }
  }).concat(unmatchedContacts)

  relationships.sort((a, b) => {
    if (a.has_pending_draft !== b.has_pending_draft) return a.has_pending_draft ? -1 : 1
    if (a.last_message_at && b.last_message_at) return a.last_message_at < b.last_message_at ? 1 : -1
    if (a.last_message_at) return -1
    if (b.last_message_at) return 1
    return a.name.localeCompare(b.name)
  })

  return NextResponse.json({ relationships })
}
