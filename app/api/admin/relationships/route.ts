import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getPartners } from "@/services/supabase/queries"
import { calcDebtTrackingSummary, deriveFreezeWindows } from "@/engines/debt/tracking"

// Architecture Migration Phase 1 (2026-07-13, owner-directed): the
// relationship list is rooted at `companies` — every real company gets a
// workspace, per the Single Workspace Principle — not at line_events like
// the old /api/admin/line-customers list. LINE presence (zero, one, or
// several linked accounts) becomes an attribute of a relationship instead
// of the thing that determines whether the relationship even appears.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  const companies = await getPartners()

  const { data: links } = await db.from("company_line_links").select("company_id, line_user_id")
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

  // Fallback match by exact LINE display name === company name, same rule
  // the old contact-rooted list used, only for LINE accounts not already
  // covered by a real company_line_links row.
  const companyByName = new Map(companies.map((c) => [c.name, c]))
  for (const a of activityByLineUserId.values()) {
    if (companyIdByLineUserId.has(a.line_user_id)) continue
    const match = a.line_name ? companyByName.get(a.line_name) : null
    if (match) {
      companyIdByLineUserId.set(a.line_user_id, match.id)
      const arr = lineUserIdsByCompany.get(match.id) ?? []
      arr.push(a.line_user_id)
      lineUserIdsByCompany.set(match.id, arr)
    }
  }

  const allCompanyIds = companies.map((c) => c.id)
  const { data: debts } = allCompanyIds.length
    ? await db.from("debt_snapshots").select("customer_company_id, total_outstanding, collection_state, debt_start_at, created_at, freeze_from, freeze_until").in("customer_company_id", allCompanyIds)
    : { data: [] }

  // Phase B (owner, 2026-07-18) — batched, one query for every company in
  // this list (not per-row), so event-derived freeze windows don't turn this
  // into N+1.
  const { data: debtEvents } = allCompanyIds.length
    ? await db.from("debt_events").select("customer_company_id, event_type, occurred_at")
        .in("customer_company_id", allCompanyIds)
        .in("event_type", ["collection_paused", "collection_resumed"])
    : { data: [] }
  const eventsByCompanyId = new Map<string, { event_type: string; occurred_at: string }[]>()
  for (const e of debtEvents ?? []) {
    const arr = eventsByCompanyId.get(e.customer_company_id) ?? []
    arr.push({ event_type: e.event_type, occurred_at: e.occurred_at })
    eventsByCompanyId.set(e.customer_company_id, arr)
  }
  // Debt Single Source of Truth (owner, 2026-07-17, PRIORITY task): the raw
  // `days_overdue`/`total_outstanding` columns are stale (see
  // engines/debt/tracking.ts's getCurrentDebt comment for the full root
  // cause) — recompute here with the same real formula instead of trusting
  // them directly. Pure-function call per row (not getCurrentDebt(), which
  // does its own DB query) so listing many relationships stays one query,
  // not N+1.
  const debtByCompanyId = new Map(
    (debts ?? [])
      .filter((d) => d.total_outstanding)
      .map((d) => {
        const summary = calcDebtTrackingSummary({
          principalAmount: Number(d.total_outstanding),
          feeRate: 0, // no fee_rate column exists yet — see tracking.ts comment
          interestStartAt: d.debt_start_at ?? d.created_at,
          // Debt Collection Freeze Window (owner, 2026-07-18) — must be
          // read here too, or the list view diverges from getCurrentDebt()
          // (used by the detail view/reminder card), reintroducing the
          // exact "multiple sources of truth" inconsistency fixed earlier.
          freezeFrom: d.freeze_from ?? null,
          freezeUntil: d.freeze_until ?? null,
          freezeWindows: deriveFreezeWindows(eventsByCompanyId.get(d.customer_company_id) ?? []),
        })
        return [d.customer_company_id, {
          total_outstanding: summary.totalAmount,
          collection_state: d.collection_state,
          days_overdue: summary.daysOverdue,
        }]
      })
  )

  const allLineUserIds = [...companyIdByLineUserId.keys()]
  const { data: pendingDrafts } = allLineUserIds.length
    ? await db.from("line_outbound_drafts").select("line_user_id").eq("status", "pending_review").in("line_user_id", allLineUserIds)
    : { data: [] }
  const pendingLineUserIds = new Set((pendingDrafts ?? []).map((d) => d.line_user_id))

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
    }
  })

  relationships.sort((a, b) => {
    if (a.has_pending_draft !== b.has_pending_draft) return a.has_pending_draft ? -1 : 1
    if (a.last_message_at && b.last_message_at) return a.last_message_at < b.last_message_at ? 1 : -1
    if (a.last_message_at) return -1
    if (b.last_message_at) return 1
    return a.name.localeCompare(b.name)
  })

  return NextResponse.json({ relationships })
}
