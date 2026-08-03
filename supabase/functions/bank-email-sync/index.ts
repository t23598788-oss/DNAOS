// Payment Verification Engine — Level 3, real (owner, 2026-07-26).
// Rule 115 always documented Level 3 (bank notification email) as
// "ยังไม่มีในระบบวันนี้" — this is that real, independent evidence source.
// A fraudster can fake a slip photo but cannot fake a real K BIZ (กสิกรไทย)
// transfer-confirmation email landing in the owner's own Gmail inbox.
//
// Real Gmail OAuth (read-only scope, gmail.readonly — never send/modify/
// delete): GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN, obtained
// via scripts/gmail-oauth-setup.mjs (one-time interactive consent, run
// locally on the owner's own Mac — Google requires a real human login for
// this, no way to automate that specific step).
//
// Same per-function cron-secret pattern as fuel-price-sync/
// receipt-reconcile-sweep (Rule 108 — no shared secret reused across jobs).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { tryAutoConfirmPayment } from "../line-webhook-v2/engines/auto-confirm-payment.ts"
import { ResponseGateway } from "../line-webhook-v2/engines/response.ts"
import { getGmailAccessToken, extractBodyText } from "../_shared/gmail-client.ts"

// getAccessToken/base64UrlDecode/htmlToPlainText/findPart/extractBodyText
// moved to ../_shared/gmail-client.ts (2026-08-03) — this file and
// supabase-billing-sync had grown identical copies (real KM-002 duplication,
// caught while building a third copy for subscription-email-sync).
const getAccessToken = getGmailAccessToken

// Real K BIZ (กสิกรไทย corporate banking) transfer-confirmation email
// format, confirmed live 2026-07-26 against real emails from the owner's
// own inbox. Each email has both a Thai section (uses "หมายเลขอ้างอิง" only
// in generic footer boilerplate, NOT the real reference field) and an
// English section (the real field is "Reference Number:") — matching the
// English labels is the actually-reliable path; kept the Thai alternates
// too since a different K BIZ template (personal-account "Other Account
// Fund Transfer" slip style) does use them as the real field. `[^\r\n]+`
// (not `.+`) stops at the real line break now that HTML is converted.
function parseKBizEmail(body: string) {
  const get = (labels: string[]) => {
    for (const label of labels) {
      const m = body.match(new RegExp(`${label}\\s*[:：]\\s*([^\\r\\n]+)`, "i"))
      if (m) return m[1].trim()
    }
    return null
  }
  const refNumber = get(["Reference Number", "หมายเลขอ้างอิง"])
  const amountRaw = get(["Amount \\(THB\\)", "จำนวนเงิน \\(บาท\\)"])
  const dateRaw = get(["Transaction Date", "วันที่ทำรายการ"]) // DD/MM/YYYY HH:MM:SS, real Gregorian year (corporate system email, not OCR)
  const senderAccount = get(["From Account", "โอนเงินจากบัญชี"])
  const receivingAccount = get(["To Account", "เพื่อเข้าบัญชี"])
  const receivingName = get(["Account Name", "ชื่อบัญชี"])

  let transactionDatetime: string | null = null
  if (dateRaw) {
    const m = dateRaw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
    if (m) {
      const [, dd, mm, yyyy, hh, min, ss] = m
      transactionDatetime = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+07:00`
    }
  }

  return {
    reference_number: refNumber,
    amount: amountRaw ? Number(amountRaw.replace(/,/g, "")) : null,
    transaction_datetime: transactionDatetime,
    sender_account_masked: senderAccount,
    receiving_account_masked: receivingAccount,
    receiving_account_name: receivingName,
  }
}

// Reverse-match on new bank email (owner, 2026-07-27): "ระบบรับข้อมูลเข้ามา
// ก่อน ประมวลผลเสร็จสรรพในคลังหลังบ้านก่อน แล้วค่อยออกไปเลย" — a slip can
// arrive before its bank-confirmation email does (the email is real but not
// instant). process-classified-image.ts only checked bank_notifications at
// the MOMENT the slip arrived; if the email wasn't there yet, the order/
// receipt just sat Pending Review forever with nothing ever re-checking it
// once the email showed up. This is that missing other half — whenever a
// NEW real bank email lands, look for a receipt_documents row already
// waiting on this exact reference_number and complete it now, for real,
// instead of leaving a human to notice and confirm manually.
async function matchPendingOnNewEmail(supabase: any, referenceNumber: string, emailAmount: number): Promise<void> {
  const { data: pendingDocs } = await supabase
    .from("receipt_documents")
    .select("id, amount, sender_name, transaction_datetime, customer_company_id, document_type, line_event_id")
    .eq("reference_number", referenceNumber)
    .eq("status", "ai_read")
  if (!pendingDocs?.length) return

  for (const doc of pendingDocs) {
    if (Math.abs(Number(doc.amount ?? 0) - emailAmount) > 5) continue // real email amount is ground truth — a non-match here means this slip is NOT what this email confirms

    const { data: lineEvent } = await supabase
      .from("line_events").select("line_user_id").eq("id", doc.line_event_id).maybeSingle()
    const userId = lineEvent?.line_user_id
    if (!userId) continue

    // Half A: cash/company invoice flow (same bar as process-classified-image.ts —
    // full OCR evidence + a real company link), now with real bank confirmation too.
    if (
      (doc.document_type === "transfer_slip" || doc.document_type === "payment_advice") &&
      doc.amount && doc.sender_name && doc.transaction_datetime && doc.customer_company_id
    ) {
      const { data: company } = await supabase
        .from("companies").select("name").eq("id", doc.customer_company_id).maybeSingle()
      await tryAutoConfirmPayment(supabase, {
        receiptDocumentId: doc.id,
        customerCompanyId: doc.customer_company_id,
        companyName: company?.name ?? "-",
        amount: Number(doc.amount),
        occurredAt: (doc.transaction_datetime ?? new Date().toISOString()).slice(0, 10),
        referenceNumber,
        lineUserId: userId,
      })
    }

    // Half B: order/quote dispatch flow — the oldest real order this same
    // customer already confirmed (awaiting_payment) whose quoted_amount now
    // matches the real bank-confirmed amount.
    const { data: pendingOrder } = await supabase
      .from("business_events")
      .select("id, event_code, quoted_amount")
      .eq("source_line_user_id", userId)
      .eq("status", "awaiting_payment")
      .not("quoted_amount", "is", null)
      .order("created_at", { ascending: true })
      .limit(1).maybeSingle()
    if (pendingOrder && Math.abs(Number(pendingOrder.quoted_amount) - emailAmount) <= 5) {
      await supabase.from("business_events")
        .update({ status: "payment_confirmed" }).eq("id", pendingOrder.id)
      await ResponseGateway.pushMessage(
        userId,
        `✅ ตรวจสอบกับธนาคารแล้ว ยอด ${emailAmount.toLocaleString()} บาท ตรงกับใบเสนอราคา ${pendingOrder.event_code} ครับ เดี๋ยวจัดรถให้เลยนะครับ`,
      )
    }
  }

  await matchPendingPartnerPayableOnNewEmail(supabase, emailAmount)
}

// Owner Dispatcher — Partner-Payable Consensus (owner, 2026-07-27): the
// owner's slip photo (handlers/image.ts) may arrive before this email does
// — reverse-match here covers that ordering, mirroring matchPendingOnNewEmail
// above. Unlike customer slips, a bank email genuinely CAN confirm this
// transaction (the owner is the one initiating the transfer), so a real
// amount match here is enough to close the loop without waiting on anything
// else. Ambiguity-safe: more than one open request at the same amount is
// left alone rather than guessed.
async function matchPendingPartnerPayableOnNewEmail(supabase: any, emailAmount: number): Promise<void> {
  const { data: pending } = await supabase
    .from("partner_payable_requests")
    .select("id, partner_name, partner_line_user_id, amount")
    .in("status", ["pending", "owner_acknowledged", "paid_confirmed"])
  const matches = (pending ?? []).filter((r: any) => Math.abs(Number(r.amount) - emailAmount) <= 5)
  if (matches.length !== 1) return

  const match = matches[0]
  await supabase.from("partner_payable_requests")
    .update({ status: "completed", bank_email_verified: true, completed_at: new Date().toISOString() })
    .eq("id", match.id)

  if (match.partner_line_user_id) {
    await ResponseGateway.pushMessage(
      match.partner_line_user_id,
      `✅ โอนเงินยอด ${Number(match.amount).toLocaleString()} บาทให้เรียบร้อยแล้วครับ`,
    )
  }
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("BANK_EMAIL_SYNC_CRON_SECRET")
  const got = req.headers.get("x-bank-email-sync-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceKey)

  const accessToken = await getAccessToken()
  if (!accessToken) {
    return Response.json({ error: "Gmail access token ล้มเหลว — เช็ค GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN" }, { status: 502 })
  }

  // One-time backfill support (owner, 2026-07-27): "อยากรู้ว่าเงินเข้ามาแล้ว
  // เงินออกกับเงินออก...ชีพจรการเงินของบริษัท" — the recurring 5-minute cron
  // only needs the last 2 days, but reconciling the real backlog (401
  // pending receipt_documents at the time this was added) or building a
  // real cash-flow view needs older real emails too. `days` in the request
  // body widens the window for a one-off manual call; the cron job's own
  // body is always `{}`, so it keeps using the safe 2-day default.
  let days = 2
  try {
    const body = await req.json()
    if (typeof body?.days === "number" && body.days > 0) days = body.days
  } catch { /* cron sends {} or empty body — default stands */ }

  // K BIZ sender confirmed live from the owner's real inbox
  // ("KBIZ@kasikornbank.com"). Paginates through every page Gmail returns
  // (up to a real safety cap) instead of a fixed maxResults, since a wide
  // backfill window can span hundreds of real emails.
  const messageIds: string[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" +
      encodeURIComponent(`from:kasikornbank.com newer_than:${days}d`) +
      "&maxResults=100" + (pageToken ? `&pageToken=${pageToken}` : "")
    const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!listRes.ok) {
      return Response.json({ error: `Gmail list API HTTP ${listRes.status}`, collectedSoFar: messageIds.length }, { status: 502 })
    }
    const listData = await listRes.json()
    messageIds.push(...(listData.messages ?? []).map((m: any) => m.id))
    pageToken = listData.nextPageToken
    pages++
  } while (pageToken && pages < 20) // real safety cap — 20 pages * 100 = 2000 messages max per call

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const id of messageIds) {
    const { data: existing } = await supabase
      .from("bank_notifications").select("id").eq("gmail_message_id", id).maybeSingle()
    if (existing) { skipped++; continue }

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!msgRes.ok) { errors.push(`message ${id}: HTTP ${msgRes.status}`); continue }
    const msg = await msgRes.json()

    const subjectHeader = msg.payload?.headers?.find((h: any) => h.name === "Subject")?.value ?? null
    const body = extractBodyText(msg.payload)
    const parsed = parseKBizEmail(body)

    const { error } = await supabase.from("bank_notifications").insert({
      gmail_message_id: id,
      reference_number: parsed.reference_number,
      amount: parsed.amount,
      transaction_datetime: parsed.transaction_datetime,
      sender_account_masked: parsed.sender_account_masked,
      receiving_account_masked: parsed.receiving_account_masked,
      receiving_account_name: parsed.receiving_account_name,
      raw_subject: subjectHeader,
      raw_body: body.slice(0, 4000), // real audit trail, bounded so one huge email can't bloat storage
    })
    if (error) errors.push(`message ${id}: ${error.message}`)
    else {
      inserted++
      if (parsed.reference_number && parsed.amount) {
        await matchPendingOnNewEmail(supabase, parsed.reference_number, Number(parsed.amount))
      }
    }
  }

  return Response.json({ ok: true, scanned: messageIds.length, inserted, skipped, errors })
})
