import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolvePresentationTemplate } from "@/engines/presentation/template-resolver"

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

  // "New customers never disappear" (owner, 2026-07-18) — relationship_id
  // for an unmatched contact is the raw line_user_id, not a companies.id (see
  // the list route's unmatchedContacts). Minimal workspace: real messages,
  // no documents/debt/events (none can exist without a company yet), plus a
  // status flag the UI uses to show "ยังไม่จับคู่บริษัท" and the match action.
  if (!company) {
    const { data: rawMessages, error: msgErr } = await db
      .from("line_events")
      .select("id, line_user_id, raw_type, raw_text, line_name, direction, extracted, media_path, created_at")
      .eq("line_user_id", relationshipId)
      .order("created_at", { ascending: true })
    if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })
    if (!rawMessages || rawMessages.length === 0) {
      return NextResponse.json({ error: "ไม่พบความสัมพันธ์นี้ในระบบ" }, { status: 404 })
    }

    const messages = await Promise.all(rawMessages.map(async (m) => {
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

    const { data: takeover } = await db.from("line_conversation_controls")
      .select("mode, reason, detected_line_event_id, assigned_to, created_at, updated_at")
      .eq("line_user_id", relationshipId).maybeSingle()

    return NextResponse.json({
      relationshipId,
      company: null,
      unmatched: true,
      lineUserIds: [relationshipId],
      primaryLineUserId: relationshipId,
      lineName: messages.find((m) => m.line_name)?.line_name ?? null,
      messages,
      documents: [],
      debt: null,
      events: [],
      receipts: [],
      unlinkedCount: messages.length,
      drafts: [],
      takeover: takeover ?? null,
    })
  }

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

  const [{ data: invoices }, { data: standalone }, { data: debtRow }, { data: partnerEvents }, { data: payables }] = await Promise.all([
    db.from("invoices").select("id, invoice_no, invoice_status, gross_amount, total_amount, invoice_date, customer_order_id").eq("customer_company_id", relationshipId),
    db.from("standalone_documents").select("id, document_no, document_type, status, gross_amount, total_amount, document_date, customer_order_id").eq("customer_company_id", relationshipId),
    db.from("debt_snapshots").select("total_outstanding, collection_state, days_overdue, debt_start_at").eq("customer_company_id", relationshipId).maybeSingle(),
    db.from("business_events").select("id, transaction_id").eq("partner_id", relationshipId),
    // Business Workspace V1 (owner, 2026-09-18): รายจ่ายต่อราย — the real
    // outgoing-side table this repo already owns (partner-payable cascade,
    // migration 20260727000003) is keyed by partner_company_id. NOT
    // company_expenses: that table attributes to the internal staff member
    // who submitted a bill (submitted_by_line_user_id), not to this
    // relationship. No recalculation — rows are read as recorded.
    db.from("partner_payable_requests").select("amount, status").eq("partner_company_id", relationshipId),
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

  // PHASE E5.1b — the per-relationship revenue summary now follows the canonical
  // semantics: VOID documents and quotations are NOT revenue (the previous version
  // counted VOID invoices and every standalone document, including quotations).
  // Amounts are the persisted gross (fallback total_amount); nothing is recomputed.
  const openInvoices = (invoices ?? []).filter(
    (d) => !["PAID", "VOID"].includes(String((d as { invoice_status?: string | null }).invoice_status ?? "")),
  )
  const revenueStandalone = (standalone ?? []).filter(
    (d) =>
      (d as { document_type?: string | null }).document_type !== "quotation" &&
      (d as { status?: string | null }).status !== "void",
  )
  const revenueDocs = [...openInvoices, ...revenueStandalone]
  const revenueTotal = revenueDocs.reduce(
    (sum, d) => sum + Number((d as { gross_amount?: number | null; total_amount?: number | null }).gross_amount ?? (d as { total_amount?: number | null }).total_amount ?? 0),
    0,
  )
  const openPayables = (payables ?? []).filter((p) => p.status !== "completed")
  const expenseTotal = openPayables.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  const finance = {
    revenue_total: revenueTotal,
    revenue_doc_count: revenueDocs.length,
    expense_total: expenseTotal,
    expense_request_count: openPayables.length,
  }
  // PHASE E5.2 — debt comes from the canonical ledger projection
  // (company_debt_current): total_outstanding = ledger, overdue days/collection
  // state = snapshot projection. Interest/penalty are NOT recomputed here; the
  // ledger records only what actually moved, so the collected amount is reported
  // as its own field instead of an invented accrual.
  const { data: debtProjection } = await db
    .from("company_debt_current")
    .select("ledger_outstanding, ledger_debt_started, ledger_receipt_received, ledger_interest_penalty_received, ledger_manual_adjustment, snapshot_collection_state, snapshot_days_overdue, last_event_at")
    .eq("company_id", relationshipId)
    .maybeSingle()
  const principalOutstanding = Math.round(
    (Number(debtProjection?.ledger_debt_started ?? 0) +
      Number(debtProjection?.ledger_manual_adjustment ?? 0) -
      Number(debtProjection?.ledger_receipt_received ?? 0)) *
      100,
  ) / 100
  const debt = debtProjection
    ? {
        total_outstanding: Math.round(Number(debtProjection.ledger_outstanding ?? 0) * 100) / 100,
        collection_state: debtProjection.snapshot_collection_state ?? debtRow?.collection_state ?? null,
        days_overdue: Number(debtProjection.snapshot_days_overdue ?? 0),
        principal: principalOutstanding,
        interest: 0,
        penalty: 0,
        collection_fee: 0,
        interest_penalty_received: Number(debtProjection.ledger_interest_penalty_received ?? 0),
        vat: null,
        calculated_at: debtProjection.last_event_at ?? null,
        basis: "company_debt_current (ledger ของ debt_events) — ไม่คำนวณดอกเบี้ย/ค่าปรับซ้ำ",
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

  const { data: takeoverRows } = lineUserIds.length
    ? await db.from("line_conversation_controls")
        .select("line_user_id, mode, reason, detected_line_event_id, assigned_to, created_at, updated_at")
        .in("line_user_id", lineUserIds).eq("mode", "human_takeover")
    : { data: [] }
  const takeover = takeoverRows?.[0] ?? null

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
    unmatched: false,
    lineUserIds,
    primaryLineUserId,
    lineName: messages.find((m) => m.line_name)?.line_name ?? null,
    messages,
    documents,
    debt,
    finance,
    events,
    receipts,
    unlinkedCount,
    drafts: drafts ?? [],
    takeover,
  })
}
