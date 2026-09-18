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

// Owner request 2026-07-24: "อยากให้มันเป็นรูปแบบเดียวกัน...การ์ด Template
// เดียวกัน" — a real card (same bubble/box/text/separator shape as
// debtReminderFlex in send-debt/route.ts), not a plain text sentence, so the
// customer's payment-confirmation message looks like every other real card
// this system sends, and the admin timeline (FlexPreview) can render the
// identical thing.
import { getLineChannelAccessToken } from "../../_shared/line-client.ts"

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

export async function tryAutoConfirmPayment(supabase: any, input: AutoConfirmInput): Promise<void> {
  // Canonical credential path (LINE cutover): bridge → Run gate — fail-closed
  // (no token → leave as Pending Review for a human, exactly as before).
  const lineToken = await getLineChannelAccessToken()
  if (!lineToken) return // can't message the customer without it — leave as Pending Review for a human

  const { data: rows, error } = await supabase.rpc("reconcile_receipt_payment", {
    p_receipt_id: input.receiptDocumentId,
    p_actor: "system:auto-ocr",
  })
  if (error) return // receipt_not_reconcilable / debt_snapshot_not_found / etc — leave as Pending Review, don't guess
  const result = rows?.[0] as {
    new_outstanding: number
    already_reconciled: boolean
  } | undefined
  if (!result) return

  // Idempotency guard (owner's own concern, 2026-07-24: same slip resent
  // 2-3-4 times) — the RPC's row lock already made this safe at the data
  // layer; this just avoids sending a second "payment received" message and
  // a second receipt for the same already-processed slip.
  if (result.already_reconciled) return

  const outstandingAfter = Number(result.new_outstanding)
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
    await supabase.from("business_events").insert({
      event_code: eventCode,
      event_type: "แจ้งชำระเงิน",
      event_date: new Date().toISOString().slice(0, 10),
      title: `รับชำระบางส่วน ${input.amount.toLocaleString("th-TH")} บาท คงเหลือ ${outstandingAfter.toLocaleString("th-TH")} บาท (อัตโนมัติ)`,
      source_line_user_id: input.lineUserId,
      partner_id: input.customerCompanyId,
      status: "awaiting_payment_date",
      confidence: 1,
      updated_at: new Date().toISOString(),
    })
  }

  await tryPushReceiptDocument(input, outstandingAfter)
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
