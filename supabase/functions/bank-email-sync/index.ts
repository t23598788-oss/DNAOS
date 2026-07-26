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

async function getAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID")
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN")
  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.access_token ?? null
}

function base64UrlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (data.length % 4)) % 4)
  // Gmail bodies are UTF-8 — atob() alone mangles Thai text, decode bytes properly.
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder("utf-8").decode(bytes)
}

// Real bug found live 2026-07-26 (first sync run, 25 real emails): K BIZ
// corporate-banking emails arrive as text/html (not text/plain) — a raw
// regex against un-stripped HTML let one greedy `.+` swallow the entire
// rest of the message, because there were no real newlines, only `<br>`
// tags. Converts to real plain text (line breaks + decoded entities) before
// any field extraction runs.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&emsp;/gi, "  ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function findPart(payload: any, mimeType: string): string | null {
  if (payload?.mimeType === mimeType && payload?.body?.data) return base64UrlDecode(payload.body.data)
  for (const part of payload?.parts ?? []) {
    const found = findPart(part, mimeType)
    if (found) return found
  }
  return null
}

function extractBodyText(payload: any): string {
  const plain = findPart(payload, "text/plain")
  if (plain) return plain
  const html = findPart(payload, "text/html") ?? (payload?.body?.data ? base64UrlDecode(payload.body.data) : "")
  return html ? htmlToPlainText(html) : ""
}

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
    else inserted++
  }

  return Response.json({ ok: true, scanned: messageIds.length, inserted, skipped, errors })
})
