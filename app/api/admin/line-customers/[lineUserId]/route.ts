import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ lineUserId: string }> }

// Full message timeline for one LINE contact, plus their matched company's
// real documents if a match exists — the "pull everything we've done with
// this customer" summary the owner asked for. Read-only.

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const db = supabase()

  const { data: rawMessages, error } = await db
    .from("line_events")
    .select("id, raw_type, raw_text, line_name, direction, created_at")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Stickers/images arrive with an empty raw_text — show a readable label
  // instead of a blank line (blank lines next to "follow" read as duplicate
  // ghost entries to anyone looking at the timeline).
  const messages = (rawMessages ?? []).map((m) => ({
    ...m,
    raw_text: m.raw_text || (m.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : m.raw_type === "image" ? "(ส่งรูปภาพ)" : m.raw_type === "follow" ? "(กดเพิ่มเพื่อน)" : m.raw_text),
  }))

  const lineName = messages.find((m) => m.line_name)?.line_name ?? null

  let documents: unknown[] = []
  let debt: unknown = null

  // Match by direct link first — a real person can have more than one LINE
  // account (e.g. ช่างมิก added a second LINE account 2026-07-10, same
  // company เคที), so this looks up via company_line_links, not a single
  // column. Only fall back to name matching if no direct link exists.
  const { data: link } = await db.from("company_line_links").select("companies(id, name, tax_id, phone)").eq("line_user_id", lineUserId).maybeSingle()
  const linkedCompany = (link as any)?.companies ?? null
  const company = linkedCompany ?? (lineName ? (await db.from("companies").select("id, name, tax_id, phone").eq("name", lineName).maybeSingle()).data : null)

  if (company) {
    const [{ data: invoices }, { data: standalone }, { data: debtRow }] = await Promise.all([
      db.from("invoices").select("id, invoice_no, invoice_status, total_amount, invoice_date").eq("customer_company_id", company.id),
      db.from("standalone_documents").select("id, document_no, document_type, total_amount, document_date").eq("customer_company_id", company.id),
      db.from("debt_snapshots").select("total_outstanding, collection_state, days_overdue, debt_start_at").eq("customer_company_id", company.id).maybeSingle(),
    ])
    documents = [...(invoices ?? []), ...(standalone ?? [])]
    debt = debtRow ?? null
  }

  const { data: events } = await db
    .from("business_events")
    .select("id, event_code, event_type, material_text, quantity, quantity_unit, destination, schedule_text, status, confidence, created_at, source_message_ids")
    .eq("source_line_user_id", lineUserId)
    .order("created_at", { ascending: false })

  const linkedMessageIds = new Set((events ?? []).flatMap((e: any) => e.source_message_ids ?? []))
  const unlinkedCount = (messages ?? []).filter((m) => !linkedMessageIds.has(m.id)).length

  // Outbound messages waiting on human approval before they go to this
  // contact (Rule 72) — surfaced right here instead of a separate page.
  const { data: drafts } = await db
    .from("line_outbound_drafts")
    .select("id, reason, proposed_text, status, created_at")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })

  return NextResponse.json({ lineUserId, lineName, messages: messages ?? [], documents, debt, events: events ?? [], unlinkedCount, drafts: drafts ?? [] })
}
