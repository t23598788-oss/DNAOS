// Autonomous Payment Confirmation (owner, 2026-07-24): explicit owner
// decision to remove the human-click step (app/api/admin/receipt-documents/
// [id]/confirm/route.ts) for OCR-read slips that are already fully legible —
// amount + sender_name + transaction_datetime all present AND the sending
// LINE account already resolves to a real company (customer_company_id).
// This is a deliberate, owner-authorized narrowing of Rule 115's "human
// confirmation is the temporary substitute for missing Level 3/4 bank
// confirmation" — the owner's own call to make (Responsibility Separation:
// Human decides Business Policy), not something to assume silently.
//
// Real production incident that started this (บจก. เคที คอนสตรัคชั่น,
// ฿5,000 slip, 2026-07-24): the slip sat unconfirmed and invisible for a day
// because of a separate classification bug (payment_advice vs transfer_slip,
// fixed alongside this). Once visible, the owner's actual ask was: don't
// make me click at all when the evidence is already complete — update the
// ledger, generate the receipt, and tell the customer the new balance right
// away. Owner's very next question, correctly: "what if the same slip gets
// sent 2-3-4 times" — this MUST be safe against exactly that.
//
// Corrected same session: the first version of this file did the ledger
// mutation as separate, non-transactional steps (select snapshot, insert
// debt_event, update snapshot, update receipt_documents) — not safe against
// two concurrent webhook deliveries (LINE redelivery, a customer resending
// the same photo) racing each other. registry/CHANGELOG-equivalent finding:
// a real, already-built, row-locked, idempotent Postgres function already
// existed for exactly this — public.reconcile_receipt_payment() (migration
// 20260723000001), never called from here. Rewired to call it instead of
// reimplementing (Rule 103) — its own `for update` row lock plus the
// `already_reconciled` check are the actual double-send guard, not
// application-level code that could itself race.
//
// LINE financial-edge removal P4 (owner decision D2 = ก, 2026-09-24): the
// call itself moved out of this provider tier again — now → Connect payment
// bridge (_shared/connect-payment.ts) → engines/canonical/
// receipt-confirm-flow.ts → confirmPayment (the canonical writer keeps the
// row-lock/idempotency guarantees; this tier keeps only send/receive).
// Same Rule 103 reasoning: no re-implementation — one sequence, two callers
// (this automatic path + the manual confirm route).

// Owner request 2026-07-24: "อยากให้มันเป็นรูปแบบเดียวกัน...การ์ด Template
// เดียวกัน" — a real card (same bubble/box/text/separator shape as
// debtReminderFlex in send-debt/route.ts), not a plain text sentence, so the
// customer's payment-confirmation message looks like every other real card
// this system sends, and the admin timeline (FlexPreview) can render the
// identical thing.
import { getLineChannelAccessToken } from "../../_shared/line-client.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../../_shared/connect-event.ts"
import { sendConnectPaymentConfirm } from "../../_shared/connect-payment.ts"

function paymentConfirmedFlex(opts: { companyName: string; amountPaid: number; outstandingAfter: number }): object {
  const paidOff = opts.outstandingAfter <= 0
  const color = paidOff ? "#2E7D32" : "#EF6C00"
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box", layout: "vertical", backgroundColor: color, paddingAll: "16px",
      contents: [{ type: "text", text: "ยืนยันรับชำระเงิน", color: "#FFFFFF", weight: "bold", size: "md" }],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: opts.companyName, weight: "bold", size: "sm", wrap: true },
        { type: "separator", margin: "sm" },
        {
          type: "box", layout: "horizontal", margin: "sm",
          contents: [
            { type: "text", text: "รับชำระแล้ว", flex: 3 },
            { type: "text", text: opts.amountPaid.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", weight: "bold", color: "#2E7D32", align: "end", flex: 2 },
          ],
        },
        { type: "separator", margin: "sm" },
        {
          type: "box", layout: "horizontal", margin: "sm",
          contents: [
            { type: "text", text: paidOff ? "คงเหลือ" : "ยอดค้างชำระคงเหลือ", weight: "bold", flex: 3 },
            { type: "text", text: opts.outstandingAfter.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", weight: "bold", color, align: "end", flex: 2 },
          ],
        },
        ...(paidOff
          ? [{ type: "text", text: "ขอบคุณครับ 🙏", size: "xs", color: "#888888" }]
          : [{ type: "text", text: "รบกวนแจ้งวันที่สะดวกชำระส่วนที่เหลือด้วยครับ", size: "xs", color: "#888888", wrap: true }]),
      ],
    },
  }
}

async function pushLineFlex(lineToken: string, lineUserId: string, altText: string, flex: object) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: "flex", altText, contents: flex }] }),
  }).catch(() => null)
  return res?.ok ?? false
}

export interface AutoConfirmInput {
  receiptDocumentId: string
  customerCompanyId: string
  companyName: string
  amount: number
  occurredAt: string // YYYY-MM-DD
  referenceNumber: string | null
  lineUserId: string
}

/**
 * Outcome contract (CANONICAL PAYMENT INTEGRITY mission, 2026-10-11 — B1
 * false-success repair). This function USED to return void, so every caller
 * mechanically reported "confirmed"/acted=true even when the canonical writer
 * rejected the attempt or the bridge was not configured (proven live:
 * payment-confirm 503 "not configured"). A caller may now only claim success
 * on { status: "confirmed" }. "already" = idempotent success (confirmed
 * earlier — no NEW money moved). Anything else maps to PENDING_REVIEW.
 */
export type AutoConfirmOutcome =
  | { status: "confirmed"; new_outstanding: number; receiptMessageSent: boolean }
  | { status: "already" }
  | { status: "rejected"; error: string }
  | { status: "skipped"; reason: string }

export async function tryAutoConfirmPayment(
  supabase: any,
  input: AutoConfirmInput,
): Promise<AutoConfirmOutcome> {
  // Canonical credential path (LINE cutover): bridge → Run gate — fail-closed
  // (no token → leave as Pending Review for a human, exactly as before).
  const lineToken = await getLineChannelAccessToken()
  if (!lineToken) {
    return { status: "skipped", reason: "LINE channel token unavailable — customer cannot be notified, left Pending Review" }
  }

  // LINE financial-edge removal P4 (owner decision D2 = ก, 2026-09-24): the
  // money mutation no longer runs in this provider tier. It goes through the
  // Connect payment bridge → receipt-confirm-flow → confirmPayment — the ONE
  // canonical payment authority (B-04 guards + atomic confirm_payment_allocation)
  // — replacing the direct reconcile_receipt_payment RPC call this file used
  // to make (that RPC stays in the database, uncalled from here; the census
  // gate enforces caller count = 0).
  //
  // Fail-closed + idempotent exactly like the legacy call it replaces:
  //   transport/eligibility failure → return (receipt stays Pending Review,
  //   a human handles it — same as the old `if (error) return`);
  //   already_reconciled → return BEFORE any customer message (the owner's
  //   own double-send guard, 2026-07-24 — now the flow's confirmed/matched/
  //   allocations pre-check + confirm_payment_allocation's row lock).
  const confirmed = await sendConnectPaymentConfirm(input.receiptDocumentId, "system:auto-ocr")
  if (!confirmed.ok) {
    return { status: "rejected", error: confirmed.error ?? "PAYMENT_CONFIRM_TRANSPORT_FAILED" }
  }
  if (!confirmed.data) {
    return { status: "rejected", error: "PAYMENT_CONFIRM_EMPTY_RESPONSE" }
  }
  if (confirmed.data.already_reconciled) {
    return { status: "already" }
  }

  const outstandingAfter = Number(confirmed.data.new_outstanding ?? 0)
  const flex = paymentConfirmedFlex({ companyName: input.companyName, amountPaid: input.amount, outstandingAfter })
  const sent = await pushLineFlex(lineToken, input.lineUserId, "ยืนยันรับชำระเงิน", flex)

  // Owner request 2026-07-24: the admin control room must show the EXACT
  // same card the customer received (via components/ui-kit/FlexPreview.tsx),
  // not a separate internal summary — same pattern as send-debt/route.ts and
  // debt-reminder-cron/index.ts. Previously this function sent a message but
  // never recorded it here at all, so it wouldn't have shown up in the admin
  // timeline in any form.
  if (sent) {
    await supabase.from("line_events").insert({
      line_user_id: input.lineUserId,
      raw_type: "flex",
      raw_text: `💰 ยืนยันรับชำระเงิน ${input.amount.toLocaleString("th-TH")} บาท ส่งอัตโนมัติแล้ว`,
      status: "processed",
      direction: "out",
      extracted: { flex },
    })
  }

  // Reuses the SAME awaiting_payment_date + tryFollowUpDebtAck flow already
  // built for the manual debt-reminder path — including its State-Specific
  // Guard Rail (KM-006) so an ambiguous next reply here doesn't get
  // silently recorded as a payment date either.
  if (outstandingAfter > 0) {
    const { count } = await supabase
      .from("business_events").select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().slice(0, 10))
    const now = new Date()
    const yy = String(now.getFullYear()).slice(-2)
    const mm = String(now.getMonth() + 1).padStart(2, "0")
    const dd = String(now.getDate()).padStart(2, "0")
    const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, "0")}`
    // Capability D: the business EVENT row goes through the Connect transport →
    // canonical writer. This is event business data only — the payment
    // reconciliation above/below stays B-04's authority (untouched).
    await sendConnectEventCommand("business_event.create", {
      event_code: eventCode,
      event_type: "แจ้งชำระเงิน",
      event_date: new Date().toISOString().slice(0, 10),
      title: `รับชำระบางส่วน ${input.amount.toLocaleString("th-TH")} บาท คงเหลือ ${outstandingAfter.toLocaleString("th-TH")} บาท (อัตโนมัติ)`,
      source_provider: CONNECT_PROVIDER,
      source_external_subject_id: input.lineUserId,
      partner_id: input.customerCompanyId,
      status: "awaiting_payment_date",
      confidence: 1,
    }, `system:${CONNECT_PROVIDER}:auto-confirm-payment`)
  }

  await tryPushReceiptDocument(input, outstandingAfter)

  // B1: the ONLY success the caller may report — the canonical writer already
  // committed (confirmed.data came back from the real payment-confirm route).
  return { status: "confirmed", new_outstanding: outstandingAfter, receiptMessageSent: sent }
}

// Generates and pushes the real ใบเสร็จรับเงิน (receipt) via the existing
// Edge-cron bridge (app/api/internal/line/document-artifact/route.ts) —
// Deno cannot import the Node PDF/image renderer directly (pdfkit/sharp).
// Best-effort: the ledger mutation above already completed regardless of
// whether this succeeds — a missing APP_BASE_URL/secret should never undo a
// real payment confirmation, just mean the receipt document itself waits
// for a human to send manually.
async function tryPushReceiptDocument(input: AutoConfirmInput, outstandingAfter: number): Promise<void> {
  const baseUrl = Deno.env.get("APP_BASE_URL")
  const secret = Deno.env.get("DOCUMENT_ARTIFACT_INTERNAL_SECRET")
  if (!baseUrl || !secret) return

  const stamp = Date.now().toString().slice(-6)
  const docNumber = `REC-${input.occurredAt.replace(/-/g, "")}-${stamp}`

  const document = {
    type: "receipt",
    docNumber,
    date: input.occurredAt,
    customer: { name: input.companyName },
    reference: input.referenceNumber ?? undefined,
    items: [{ description: "รับชำระเงิน", qty: 1, unit: "รายการ", unitPrice: input.amount }],
    notes: outstandingAfter > 0
      ? `คงเหลือยอดค้างชำระ ${outstandingAfter.toLocaleString("th-TH")} บาท`
      : "ชำระครบยอดแล้ว",
  }

  await fetch(`${baseUrl}/api/internal/line/document-artifact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-document-artifact-secret": secret },
    body: JSON.stringify({
      lineUserId: input.lineUserId,
      documentId: docNumber,
      altText: `ใบรับเงิน ${docNumber}`,
      document,
    }),
  }).catch(() => {}) // best-effort — the real ledger mutation already happened above
}
