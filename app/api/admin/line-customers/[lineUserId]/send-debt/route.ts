import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { createBusinessEvent } from "@/engines/canonical/event-write"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { debtReminderFlex } from "@/engines/documents/flex-template"
import { loadCompanySettings } from "@/core/config/company-settings"
import { sendLineMessage } from "@/registry/communication"
import { normalizeSendResult } from "@/app/api/admin/ide/_lib/businessFailureBridge"
import { isDebtPreviewMode } from "@/engines/debt/preview-mode"

type Params = { params: Promise<{ lineUserId: string }> }

/** The provider this admin screen acts on — a value, never a branch. */
const PROVIDER = "line"

// Owner request 2026-07-11: the debt figure shown in this page's header was
// only ever passive display — เฮีย wants a one-click "send" from the same
// screen. Re-reads debt_snapshots fresh from the DB server-side rather than
// trusting whatever the client had cached, since this is a real financial
// figure going out to a customer.

// Owner request 2026-07-11: "ให้เห็นภาพรายการก่อนที่จะกดส่งยืนยัน" — this route
// now takes an optional body { mode: "preview" | "execute" } (default
// "preview"). Preview builds and returns the real Flex card without pushing
// or writing anything; only "execute" actually sends and logs. The admin UI
// calls preview first, shows the card, then re-POSTs with mode:"execute".
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  // SAFE PREVIEW MODE (M026) — a staging screen must be able to press every
  // button without a real customer receiving anything. Preview of the card
  // itself is still allowed below; only the real push is refused.
  const previewMode = isDebtPreviewMode(process.env)

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const mode = body?.mode === "execute" ? "execute" : "preview"
  const db = supabase()

  const { data: link } = await db
    .from("company_line_links").select("companies(id, name)").eq("line_user_id", lineUserId).maybeSingle()
  const company = (link as any)?.companies ?? null
  if (!company) return NextResponse.json({ error: "ยังไม่จับคู่บริษัทลูกค้า" }, { status: 400 })

  // PHASE E5.2 — the amount sent to a real customer now comes from the canonical
  // ledger projection (company_debt_current). The legacy engine's
  // principal+interest+penalty recalculation is NOT used here any more: the ledger
  // already carries every movement, and interest/penalty that were actually
  // collected are its own event type (reported separately, never re-derived).
  const { data: debtProjection } = await db
    .from("company_debt_current")
    .select("ledger_outstanding, ledger_debt_started, ledger_receipt_received, ledger_interest_penalty_received, ledger_manual_adjustment, snapshot_collection_state, snapshot_days_overdue")
    .eq("company_id", company.id)
    .maybeSingle()
  const { data: debtRow } = await db
    .from("debt_snapshots")
    .select("debt_type, document_type")
    .eq("customer_company_id", company.id)
    .maybeSingle()

  const ledgerOutstanding = Number(debtProjection?.ledger_outstanding ?? 0)
  const principalOutstanding = Math.round(
    (Number(debtProjection?.ledger_debt_started ?? 0) +
      Number(debtProjection?.ledger_manual_adjustment ?? 0) -
      Number(debtProjection?.ledger_receipt_received ?? 0)) *
      100,
  ) / 100
  const interestPenaltyReceived = Number(debtProjection?.ledger_interest_penalty_received ?? 0)

  const debt = debtRow
    ? {
        total_due: Math.round(ledgerOutstanding * 100) / 100,
        overdue_days: Number(debtProjection?.snapshot_days_overdue ?? 0),
        principal: principalOutstanding,
        // the ledger does not accrue interest/penalty (only records what was received),
        // so nothing is invented here — the collected amount is shown separately
        interest: 0,
        penalty: 0,
        collection_fee: 0,
        interest_penalty_received: interestPenaltyReceived,
        debt_type: debtRow.debt_type,
        document_type: debtRow.document_type,
      }
    : null

  if (!debt || debt.total_due <= 0) {
    return NextResponse.json({ error: "ไม่มียอดหนี้ค้างชำระให้ส่ง" }, { status: 400 })
  }

  // Debt Tracking Model — Phase B (owner, 2026-07-18): this button may only
  // send the collection_reminder_notice card. A debt classified
  // trade_receivable belongs to the Invoice module instead — document choice
  // is a property of the debt row, not this button. document_type null
  // (pre-migration data) is allowed through rather than blocked, since
  // blocking would regress every existing customer before the backfill runs.
  if (debt.document_type && debt.document_type !== "collection_reminder_notice") {
    return NextResponse.json(
      { error: `หนี้รายนี้จัดประเภทเป็น ${debt.debt_type} — ต้องออกเอกสารผ่านโมดูล Invoice ไม่ใช่การ์ดแจ้งยอดค้างชำระ` },
      { status: 400 },
    )
  }

  const branding = await loadCompanySettings()
  const flex = debtReminderFlex({
    companyName: company.name,
    totalOutstanding: debt.total_due,
    daysOverdue: debt.overdue_days,
    // Owner request 2026-07-18: itemize the card (principal/interest/
    // penalty/collection_fee) instead of one lump total — getCurrentDebt()
    // already computes all of these, just wasn't threading them through.
    principal: debt.principal,
    interest: debt.interest,
    penalty: debt.penalty,
    collectionFee: debt.collection_fee,
    branding: {
      ourCompanyName: branding.companyName || undefined,
      ourCompanyTaxId: branding.companyTaxId || undefined,
      terms: branding.documentTerms || undefined,
      footerNote: branding.documentFooterNote || undefined,
    },
  })

  if (mode === "preview") {
    return NextResponse.json({ ok: true, flex_preview: flex, safe_preview_mode: previewMode })
  }

  if (previewMode) {
    return NextResponse.json(
      {
        error: "SAFE PREVIEW MODE — ไม่ส่ง LINE จริงในสภาพแวดล้อมนี้",
        reason: "PREVIEW_MODE_ACTIVE",
        flex_preview: flex,
      },
      { status: 409 },
    )
  }

  const lineRes = await sendLineMessage(supabase(), lineUserId, [
    { type: "flex", altText: "แจ้งยอดค้างชำระ", contents: flex },
  ])

  // Business → Infrastructure failure bridge (owner, 2026-09-19): the
  // debt figure and business_event stay untouched on infrastructure
  // failure (writes below never run); Business receives ONLY the
  // normalized result — never raw provider error text.
  const normalized = await normalizeSendResult(lineRes, {
    providerSlug: "line",
    businessAction: "line.send_debt",
    ownerId: auth.id,
    actor: auth.email,
    source: "/api/admin/line-customers/[lineUserId]/send-debt",
  })
  if (!normalized.ok) {
    return NextResponse.json(normalized, { status: 503 })
  }

  await db.from("line_events").insert({
    line_user_id: lineUserId,
    raw_type: "flex",
    raw_text: `💰 แจ้งยอดค้างชำระ ${debt.total_due.toLocaleString("th-TH")} บาท ส่งให้ลูกค้าแล้ว`,
    status: "processed",
    direction: "out",
    // Delivery evidence completeness (mission 2026-10-10 §4): the provider
    // message id from the push answer — same field every other out writer
    // records since BATCH 38.
    line_message_id: lineRes.messageId ?? null,
    // Owner request 2026-07-24: admin control room must show the EXACT card
    // the customer received — the real Flex JSON, not a paraphrased summary.
    extracted: { flex },
  })

  // Owner-reported gap 2026-07-11: after this card goes out, a customer
  // reply like "รับทราบครับ" fell into the generic "เดี๋ยวเช็คให้นะครับ"
  // fallback, which makes no sense as a reply to an acknowledgment. This
  // row is what supabase/functions/line-webhook-v2/engines/debt-followup.ts
  // looks for to ask a real follow-up (the payment date) instead. A
  // dedicated status (not awaiting_info/ready_to_quote) keeps this out of
  // the quotation queue, which isn't relevant here.
  const { count } = await db
    .from("business_events").select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().slice(0, 10))
  const yy = new Date().getFullYear().toString().slice(-2)
  const mm = String(new Date().getMonth() + 1).padStart(2, "0")
  const dd = String(new Date().getDate()).padStart(2, "0")
  const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, "0")}`

  // Capability D: created through the canonical Business Event writer. The
  // canonical input carries a provider-neutral source reference; the legacy
  // provider-shaped column names never appear here.
  await createBusinessEvent(db, {
    eventCode,
    eventType: "แจ้งชำระเงิน",
    eventDate: new Date().toISOString().slice(0, 10),
    title: `แจ้งยอดค้างชำระ ${debt.total_due.toLocaleString("th-TH")} บาท`,
    source: { provider: PROVIDER, externalSubjectId: lineUserId },
    partnerId: company.id,
    status: "awaiting_payment_date",
    confidence: 1,
    actor: auth.email ?? auth.id ?? "admin",
  })

  return NextResponse.json({ ok: true })
}
