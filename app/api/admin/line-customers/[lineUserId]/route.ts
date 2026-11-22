import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

type Params = { params: Promise<{ lineUserId: string }> }

// Full message timeline for one LINE contact, plus their matched company's
// real documents if a match exists — the "pull everything we've done with
// this customer" summary the owner asked for. Read-only.

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  const db = supabase()

  // Scope is decided by the explicit link, before any message is read: a
  // contact linked to another organization's company must look non-existent.
  const { data: scopeLink } = await db
    .from("company_line_links")
    .select("company_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  if (!isCompanyVisible(ctx, scopeLink?.company_id)) return notFound()

  const { data: rawMessages, error } = await db
    .from("line_events")
    .select("id, raw_type, raw_text, line_name, direction, extracted, created_at, line_message_id, status, media_path")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Stickers/images arrive with an empty raw_text — show a readable label
  // instead of a blank line (blank lines next to "follow" read as duplicate
  // ghost entries to anyone looking at the timeline). Attachments (mission
  // 2026-10-10 §2 item 4) get a fresh 5-min signed URL from the SAME private
  // 'attachments' bucket + media_path pattern the relationships feed already
  // uses — no new storage path, no public bucket.
  const messages = await Promise.all(
    (rawMessages ?? []).map(async (m) => {
      let media_url: string | null = null
      if (m.media_path) {
        const { data: signed } = await db.storage.from("attachments").createSignedUrl(m.media_path, 60 * 5)
        media_url = signed?.signedUrl ?? null
      }
      return {
        ...m,
        media_url,
        raw_text: m.raw_text || (m.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : m.raw_type === "image" ? "(ส่งรูปภาพ)" : m.raw_type === "follow" ? "(กดเพิ่มเพื่อน)" : m.raw_text),
      }
    }),
  )

  const lineName = messages.find((m) => m.line_name)?.line_name ?? null

  let documents: unknown[] = []
  let debt: unknown = null

  // Match ONLY by an explicit link — a real person can have more than one LINE
  // account, so the link table is the identity edge. STEP 2 (2026-10-25): the
  // old exact-name fallback was removed; a LINE display name is not identity and
  // could resolve to a different company.
  const { data: link } = await db.from("company_line_links").select("companies(id, name, tax_id, phone)").eq("line_user_id", lineUserId).maybeSingle()
  const company = (link as any)?.companies ?? null

  if (company) {
    const [{ data: invoices }, { data: standalone }, { data: debtRow }] = await Promise.all([
      db.from("invoices").select("id, invoice_no, invoice_status, total_amount, invoice_date").eq("customer_company_id", company.id),
      db.from("standalone_documents").select("id, document_no, document_type, total_amount, document_date").eq("customer_company_id", company.id),
      // PHASE E5.2 — one read of the canonical debt projection; the legacy
      // interest/penalty recalculation is gone from this path.
      db
        .from("company_debt_current")
        .select("ledger_outstanding, snapshot_collection_state, snapshot_days_overdue, ledger_event_count")
        .eq("company_id", company.id)
        .maybeSingle(),
    ])
    // Tag each row with which real table it came from — the send-document
    // route needs to know where to re-read it from (owner request 2026-07-11:
    // existing documents get a "ส่ง" button too, not just newly-created ones).
    documents = [
      ...(invoices ?? []).map((d) => ({ ...d, table: "invoices" as const })),
      ...(standalone ?? []).map((d) => ({ ...d, table: "standalone_documents" as const })),
    ]
    // PHASE E5.2 — debt comes from the canonical ledger projection:
    //   total_outstanding = ledger, days_overdue = snapshot projection,
    //   collection_state = snapshot projection. Nothing is recalculated here.
    debt = debtRow
      ? {
          total_outstanding: Number(debtRow.ledger_outstanding ?? 0),
          collection_state: debtRow.snapshot_collection_state ?? null,
          days_overdue: Number(debtRow.snapshot_days_overdue ?? 0),
          ledger_event_count: Number(debtRow.ledger_event_count ?? 0),
        }
      : null
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
