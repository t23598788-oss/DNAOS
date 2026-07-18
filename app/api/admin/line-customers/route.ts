import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { calcDebtTrackingSummary, deriveFreezeWindows } from "@/engines/debt/tracking"

// Cross-reference view: every distinct LINE contact, their message history,
// and — where the LINE display name matches a real company/partner record —
// that company's debt status. Read-only, built entirely from tables already
// populated this session (line_events + companies + debt_snapshots). No new
// business capability, no writes.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()

  const { data: events, error } = await db
    .from("line_events")
    .select("id, line_user_id, line_name, line_picture, raw_type, raw_text, created_at")
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
    ? await db.from("company_line_links").select("line_user_id, companies(id, name, tax_id, phone)").in("line_user_id", lineUserIds)
    : { data: [] }
  const { data: namedCompanies } = names.length
    ? await db.from("companies").select("id, name, tax_id, phone").in("name", names)
    : { data: [] }

  const companyByLineUserId = new Map(
    (links ?? []).filter((l: any) => l.companies).map((l: any) => [l.line_user_id as string, l.companies])
  )
  const companyByName = new Map((namedCompanies ?? []).map((c) => [c.name, c]))
  const allCompanyIds = [...companyByLineUserId.values(), ...(namedCompanies ?? [])].map((c: any) => c.id)

  const { data: debts } = allCompanyIds.length
    ? await db.from("debt_snapshots").select("customer_company_id, total_outstanding, collection_state, debt_start_at, created_at, freeze_from, freeze_until").in("customer_company_id", allCompanyIds)
    : { data: [] }

  // Phase B (owner, 2026-07-18) — batched, one query for the whole list, see
  // app/api/admin/relationships/route.ts's identical comment.
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

  // Debt Single Source of Truth (owner, 2026-07-17, PRIORITY task) — was
  // storing the raw stale total_outstanding (never recomputed with
  // interest/penalty — see engines/debt/tracking.ts's getCurrentDebt
  // comment). Same formula as every other consumer, computed once per row
  // here (not getCurrentDebt(), which would be N+1 queries for a list).
  const debtByCompanyId = new Map(
    (debts ?? [])
      .filter((d) => d.total_outstanding)
      .map((d) => {
        const summary = calcDebtTrackingSummary({
          principalAmount: Number(d.total_outstanding),
          feeRate: 0,
          interestStartAt: d.debt_start_at ?? d.created_at,
          // Debt Collection Freeze Window (owner, 2026-07-18) — see
          // app/api/admin/relationships/route.ts's identical comment.
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
