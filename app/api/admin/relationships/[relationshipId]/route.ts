import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolvePresentationTemplate } from "@/engines/presentation/template-resolver"
import { getCurrentDebt } from "@/engines/debt/tracking"

type Params = { params: Promise<{ relationshipId: string }> }

// Architecture Migration Phase 1 (2026-07-13, owner-directed): workspace
// identity moves from line_user_id to relationship_id (= companies.id).
// LINE is now one communication channel a relationship may have zero, one,
// or several accounts of (owner-confirmed real case: ช่างมิก / เคที
// คอนสตรัคชั่น has 2) — not the root identity. Business logic (which
// documents/debt/events belong to a company, how messages get labeled) is
// unchanged from the old lineUserId-keyed route; only the identity
// direction and the "may have zero LINE threads" case are new.

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { relationshipId } = await params
  const db = supabase()

  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id, name, tax_id, phone")
    .eq("id", relationshipId)
    .maybeSingle()

  if (companyError) return NextResponse.json({ error: companyError.message }, { status: 500 })
  if (!company) return NextResponse.json({ error: "ไม่พบความสัมพันธ์นี้ในระบบ" }, { status: 404 })

  // A relationship may have zero LINE threads (a company that has never
  // messaged us) — every real company still gets a workspace, per the
  // Single Workspace Principle, not just LINE-linked ones.
  const { data: links } = await db
    .from("company_line_links")
    .select("line_user_id")
    .eq("company_id", relationshipId)
  const lineUserIds = (links ?? []).map((l) => l.line_user_id as string)

  const { data: rawMessages } = lineUserIds.length
    ? await db
        .from("line_events")
        .select("id, line_user_id, raw_type, raw_text, line_name, direction, extracted, media_path, created_at")
        .in("line_user_id", lineUserIds)
        .order("created_at", { ascending: true })
    : { data: [] }

  // Human Reality Timeline (owner, 2026-07-16/17): "รูปภาพ → เห็นรูปเดิม" —
  // media_path is a private Storage path (see 20260717000001 migration),
  // never persisted as a URL since signed URLs expire; sign fresh here on
  // every real read, same 5-minute pattern app/api/admin/upload/route.ts
  // already uses for the same 'attachments' bucket.
  const messages = await Promise.all((rawMessages ?? []).map(async (m) => {
    let mediaUrl: string | null = null
    if (m.media_path) {
      const { data: signed } = await db.storage.from("attachments").createSignedUrl(m.media_path, 60 * 5)
      mediaUrl = signed?.signedUrl ?? null
    }
    return {
      ...m,
      raw_text: m.raw_text || (m.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : m.raw_type === "image" ? "(ส่งรูปภาพ)" : m.raw_type === "follow" ? "(กดเพิ่มเพื่อน)" : m.raw_text),
      media_url: mediaUrl,
    }
  }))

  // Default send-target when an action (reply, debt reminder, send document)
  // needs one specific LINE thread — the most recently active linked
  // account. Preserves existing per-line_user_id send mechanics unchanged;
  // only the workspace's root identity changed, not how LINE sends work.
  const primaryLineUserId = messages.length ? [...messages].reverse()[0].line_user_id : lineUserIds[0] ?? null

  const [{ data: invoices }, { data: standalone }, { data: debtRow }, { data: partnerEvents }] = await Promise.all([
    db.from("invoices").select("id, invoice_no, invoice_status, total_amount, invoice_date, customer_order_id").eq("customer_company_id", relationshipId),
    db.from("standalone_documents").select("id, document_no, document_type, total_amount, document_date, customer_order_id").eq("customer_company_id", relationshipId),
    db.from("debt_snapshots").select("total_outstanding, collection_state, days_overdue, debt_start_at").eq("customer_company_id", relationshipId).maybeSingle(),
    db.from("business_events").select("id, transaction_id").eq("partner_id", relationshipId),
  ])

  const eventByTransactionId = new Map(
    (partnerEvents ?? [])
      .filter((event) => event.transaction_id)
      .map((event) => [event.transaction_id as string, event.id as string])
  )
  const withPresentation = <T extends { id: string; customer_order_id?: string | null }>(doc: T) => {
    const businessEventId = doc.customer_order_id ? eventByTransactionId.get(doc.customer_order_id) ?? null : null
    const template = resolvePresentationTemplate({
      source_kind: "document",
      source_id: doc.id,
      business_event_id: businessEventId,
    })
    return {
      ...doc,
      business_event_id: businessEventId,
      template_key: template.template_key,
      presentation_template: template.template_id,
      presentation_type: template.template_id,
    }
  }
  const documents = [
    ...(invoices ?? []).map((d) => ({ ...withPresentation(d), table: "invoices" as const })),
    ...(standalone ?? []).map((d) => ({ ...withPresentation(d), table: "standalone_documents" as const })),
  ]
  // Debt Single Source of Truth (owner, 2026-07-17, PRIORITY task): was
  // `debtRow` — the raw debt_snapshots.total_outstanding, a stale number set
  // once and never recomputed with interest/penalty (root cause: see
  // getCurrentDebt's own comment in engines/debt/tracking.ts). Every field
  // the Chat header/Relationship page shows now comes from the same
  // authoritative calculation the Debt Tracking Manager and debt notices
  // already use — no separate calculation here.
  const currentDebt = await getCurrentDebt(relationshipId)
  const debt = currentDebt
    ? {
        total_outstanding: currentDebt.total_due,
        collection_state: debtRow?.collection_state ?? null,
        days_overdue: currentDebt.overdue_days,
        principal: currentDebt.principal,
        interest: currentDebt.interest,
        penalty: currentDebt.penalty,
        collection_fee: currentDebt.collection_fee,
        vat: currentDebt.vat,
        calculated_at: currentDebt.calculated_at,
      }
    : debtRow ?? null

  // Business events reach a relationship two ways: already resolved to this
  // company (partner_id) or only linked via the raw LINE thread so far
  // (source_line_user_id) — union both, deduped by id, same as a company
  // could have events from before a LINE link existed at all.
  const { data: eventsByPartner } = await db
    .from("business_events")
    .select("id, event_code, event_type, material_text, quantity, quantity_unit, destination, schedule_text, contact_name, contact_phone, status, confidence, created_at, source_message_ids")
    .eq("partner_id", relationshipId)
  const { data: eventsByLine } = lineUserIds.length
    ? await db
        .from("business_events")
        .select("id, event_code, event_type, material_text, quantity, quantity_unit, destination, schedule_text, contact_name, contact_phone, status, confidence, created_at, source_message_ids")
        .in("source_line_user_id", lineUserIds)
    : { data: [] }

  const eventsById = new Map<string, any>()
  for (const e of [...(eventsByPartner ?? []), ...(eventsByLine ?? [])]) eventsById.set(e.id, e)
  const events = Array.from(eventsById.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  const linkedMessageIds = new Set(events.flatMap((e) => e.source_message_ids ?? []))
  const unlinkedCount = messages.filter((m) => !linkedMessageIds.has(m.id)).length

  const { data: drafts } = lineUserIds.length
    ? await db
        .from("line_outbound_drafts")
        .select("id, line_user_id, reason, proposed_text, status, created_at")
        .in("line_user_id", lineUserIds)
        .order("created_at", { ascending: false })
    : { data: [] }

  // Auto document classification (owner, 2026-07-17) — receipt_documents is
  // keyed by line_event_id, which is exactly `messages[].id` above (both
  // read from line_events). Same signed-URL-per-request pattern as message
  // images (private bucket, no persisted URL).
  const messageIds = messages.map((m) => m.id)
  const { data: rawReceipts } = messageIds.length
    ? await db
        .from("receipt_documents")
        .select("id, line_event_id, media_path, document_type, vendor_name, amount, document_date, confidence, status, error_th, created_at")
        .in("line_event_id", messageIds)
    : { data: [] }
  const lineNameByEventId = new Map(messages.map((m) => [m.id, m.line_name as string | null]))
  const receipts = await Promise.all((rawReceipts ?? []).map(async (r) => {
    const { data: signed } = await db.storage.from("attachments").createSignedUrl(r.media_path, 60 * 5)
    return {
      ...r,
      media_url: signed?.signedUrl ?? null,
      sender_name: lineNameByEventId.get(r.line_event_id) ?? null,
    }
  }))

  return NextResponse.json({
    relationshipId,
    company,
    lineUserIds,
    primaryLineUserId,
    lineName: messages.find((m) => m.line_name)?.line_name ?? null,
    messages,
    documents,
    debt,
    events,
    receipts,
    unlinkedCount,
    drafts: drafts ?? [],
  })
}
