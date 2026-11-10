import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

// Cross-reference view: every distinct LINE contact, their message history,
// and — where the LINE display name matches a real company/partner record —
// that company's debt status. Read-only, built entirely from tables already
// populated this session (line_events + companies + debt_snapshots). No new
// business capability, no writes.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  // Open inbound pipeline: chat identity/avatar stream is NOT gated by
  // business scope. An org with no visible companies still sees inbound
  // conversations; business overlay (company/debt) simply stays null.

  const db = supabase()

  // Open inbound pipeline: fetch EVERY inbound LINE event regardless of
  // business binding/company scope, so avatar/name/message are available for
  // all contacts immediately.
  const eventsQuery = db
    .from("line_events")
    .select("id, line_user_id, line_name, line_picture, raw_type, raw_text, created_at")
  const { data: events, error } = await eventsQuery.order("created_at", { ascending: true })

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
      // Keep the most recent LINE picture so avatar updates on every inbound.
      if (e.line_picture) existing.line_picture = e.line_picture
    }
  }

  const contacts = Array.from(byUser.values())
  const lineUserIds = contacts.map((c) => c.line_user_id)

  // STEP 2 (2026-10-25): identity is the explicit link only. A LINE display
  // name is NOT identity — the old exact-name fallback could attach a contact
  // (and its debt figures) to a different company that happened to share the
  // name.
  let linksQuery = db.from("company_line_links").select("line_user_id, company_id, companies(id, name, tax_id, phone)")
  if (ctx.companyIds) linksQuery = linksQuery.in("company_id", [...ctx.companyIds])
  const { data: links } = lineUserIds.length
    ? await linksQuery.in("line_user_id", lineUserIds)
    : { data: [] }

  const companyByLineUserId = new Map(
    (links ?? []).filter((l: any) => l.companies).map((l: any) => [l.line_user_id as string, l.companies])
  )
  const allCompanyIds = [...companyByLineUserId.values()].map((c: any) => c.id)

  // Partner channel bindings (auto-learned LINE identity → partner_business_profiles).
  // Unknown-first: a LINE id may have no binding yet (unidentified lead); it is
  // still returned and tagged as unidentified instead of being dropped.
  const { data: bindings } = lineUserIds.length
    ? await db
        .from("partner_channel_bindings")
        .select("id, channel_user_id, partner_business_profile_id, display_name, avatar_url, verified, confidence, partner_business_profiles(id, pit_profiles(pit_name, registered_name))")
        .eq("channel_type", "LINE")
        .in("channel_user_id", lineUserIds)
    : { data: [] }
  const bindingByUserId = new Map(
    (bindings ?? []).map((b: any) => [b.channel_user_id as string, b]),
  )

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

  // Open inbound pipeline: return all contacts; business overlay is attached
  // only where an in-scope company link exists.
  const result = contacts
    .map((c) => {
      const company = companyByLineUserId.get(c.line_user_id) ?? null
      const debt = company ? debtByCompanyId.get(company.id) : null
      const binding = bindingByUserId.get(c.line_user_id) ?? null
      const partnerProfileRaw = (binding?.partner_business_profiles as any)
      const partnerProfile = Array.isArray(partnerProfileRaw) ? partnerProfileRaw[0] : partnerProfileRaw
      const pitRaw = partnerProfile?.pit_profiles
      const pitProfile = Array.isArray(pitRaw) ? pitRaw[0] : pitRaw
      const partnerName = pitProfile?.pit_name ?? pitProfile?.registered_name ?? null
      const isUnidentified = !binding || !binding.partner_business_profile_id
      return {
        ...c,
        line_name: binding?.display_name ?? c.line_name,
        line_picture: c.line_picture,
        avatar_url: binding?.avatar_url ?? c.line_picture ?? null,
        matched_company: company
          ? { id: company.id, name: company.name, tax_id: company.tax_id, phone: company.phone }
          : null,
        partner_binding: binding
          ? {
              id: binding.id,
              partner_profile_id: binding.partner_business_profile_id,
              partner_name: partnerName,
              display_name: binding.display_name,
              avatar_url: binding.avatar_url,
              verified: binding.verified,
              confidence: binding.confidence,
            }
          : null,
        is_unidentified: isUnidentified,
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
